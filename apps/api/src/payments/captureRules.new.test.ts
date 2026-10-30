import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import { loadConfig } from "../config.js";
import { UnprocessableEntityError } from "../lib/errors.js";
import { authorizeTransaction } from "./authorize.js";
import { captureTransaction } from "./capture.js";
import { voidTransaction } from "./void.js";
import { calculateDiscountedMdrFee } from "../v1/fees/calculateFee.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("captureRules.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 6 });
test.after(() => pool.end());
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
});
const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };
const acquirer = createAcquirerSimulator(config);

async function merchant(mdr = 250, discount = 0): Promise<string> {
  const row = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps, onboarding_status)
     VALUES ($1, $2, $3, 'approved') RETURNING id`,
    [`Capture rules ${randomUUID()}`, mdr, discount],
  );
  return row.rows[0]!.id;
}

async function authorized(merchantId: string, amount = 10000): Promise<string> {
  const result = await authorizeTransaction(pool, acquirer, {
    merchantId,
    amountFils: toFils(amount),
    card,
    idempotencyKey: randomUUID(),
    actor: { type: "system" },
  });
  assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  return (result.body as { id: string }).id;
}

test("discounted MDR matches settlement: 602 fils at 275 bps with 1250 bps discount is 14", async () => {
  assert.equal(calculateDiscountedMdrFee(toFils(602), 275, 1250), 14);
  const merchantId = await merchant(275, 1250);
  const id = await authorized(merchantId, 602);
  const captured = await captureTransaction(pool, acquirer, {
    transactionId: id,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: merchantId },
  });
  assert.equal(captured.statusCode, 200, JSON.stringify(captured.body));
  const fee = await pool.query<{ fils: string }>(
    `SELECT amount_fils::text AS fils FROM ledger_entries
      WHERE transaction_id = $1 AND account_id = 'platform_fee_revenue' AND direction = 'credit'`,
    [id],
  );
  assert.equal(fee.rows[0]!.fils, "14");
});

test("capture rejects an expired or missing hold and does not call the acquirer", async () => {
  const merchantId = await merchant();
  const expired = await authorized(merchantId, 5000);
  await pool.query(`UPDATE holds SET expires_at = now() - interval '1 second' WHERE transaction_id = $1`, [expired]);
  let calls = 0;
  const counting = {
    authorize: acquirer.authorize.bind(acquirer),
    capture: async (req: Parameters<typeof acquirer.capture>[0]) => {
      calls += 1;
      return acquirer.capture(req);
    },
    refund: acquirer.refund.bind(acquirer),
  };
  const denied = await captureTransaction(pool, counting, {
    transactionId: expired,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: merchantId },
  });
  assert.equal(denied.statusCode, 409);
  assert.equal((denied.body as { error: string }).error, "authorization_hold_expired");
  assert.equal(calls, 0);
  const status = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [expired]);
  assert.equal(status.rows[0]!.status, "authorized");

  const missing = await authorized(merchantId, 5000);
  await pool.query(`DELETE FROM holds WHERE transaction_id = $1`, [missing]);
  const gone = await captureTransaction(pool, counting, {
    transactionId: missing,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: merchantId },
  });
  assert.equal(gone.statusCode, 409);
  assert.equal(calls, 0);
});

test("a capture key is bound to its transaction and does not replay onto another", async () => {
  const merchantId = await merchant();
  const first = await authorized(merchantId, 4000);
  const second = await authorized(merchantId, 4000);
  const key = randomUUID();
  const ok = await captureTransaction(pool, acquirer, {
    transactionId: first,
    merchantId,
    idempotencyKey: key,
    actor: { type: "system", id: merchantId },
  });
  assert.equal(ok.statusCode, 200);
  await assert.rejects(
    () => captureTransaction(pool, acquirer, {
      transactionId: second,
      merchantId,
      amountFils: toFils(4000),
      idempotencyKey: key,
      actor: { type: "system", id: merchantId },
    }),
    (err: unknown) => err instanceof UnprocessableEntityError && err.statusCode === 422,
  );
  const row = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [second]);
  assert.equal(row.rows[0]!.status, "authorized");
});

test("the transaction row lock is not held across the acquirer call", async () => {
  const merchantId = await merchant();
  const id = await authorized(merchantId, 3000);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const slow = {
    authorize: acquirer.authorize.bind(acquirer),
    capture: async (req: Parameters<typeof acquirer.capture>[0]) => {
      entered();
      await gate;
      return acquirer.capture(req);
    },
    refund: acquirer.refund.bind(acquirer),
  };
  const pending = captureTransaction(pool, slow, {
    transactionId: id,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: merchantId },
  });
  await started;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '500ms'");
    await client.query(`SELECT id FROM transactions WHERE id = $1 FOR UPDATE`, [id]);
    await client.query("COMMIT");
  } finally {
    client.release();
    finish();
  }
  assert.equal((await pending).statusCode, 200);
});

test("void does not reverse an authorization while its capture is in flight", async () => {
  const merchantId = await merchant();
  const id = await authorized(merchantId, 2500);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let finish!: () => void;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const slow = {
    authorize: acquirer.authorize.bind(acquirer),
    capture: async (req: Parameters<typeof acquirer.capture>[0]) => {
      entered();
      await gate;
      return acquirer.capture(req);
    },
    refund: acquirer.refund.bind(acquirer),
  };
  const pending = captureTransaction(pool, slow, {
    transactionId: id,
    merchantId,
    idempotencyKey: randomUUID(),
    actor: { type: "system", id: merchantId },
  });
  await started;
  const voided = await voidTransaction(pool, { transactionId: id, merchantId, actor: { type: "system", id: merchantId } });
  assert.equal(voided.statusCode, 409);
  assert.equal((voided.body as { error: string }).error, "request_in_progress");
  finish();
  assert.equal((await pending).statusCode, 200);
  const status = await pool.query<{ status: string }>(`SELECT status FROM transactions WHERE id = $1`, [id]);
  assert.equal(status.rows[0]!.status, "captured");
});
