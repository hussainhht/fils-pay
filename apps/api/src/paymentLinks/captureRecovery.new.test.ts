import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createAcquirerSimulator } from "../acquirer/simulator.js";
import { loadConfig } from "../config.js";
import { payPaymentLink } from "./pay.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("captureRecovery.new.test.ts requires DATABASE_URL");

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
const settings = { paymentLinkReservationTimeoutSeconds: 60 };

test("an ambiguous capture is resumed on the same operation and is not voided", async () => {
  const merchantId = (await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, onboarding_status) VALUES ('Recovery', 250, 'approved') RETURNING id`,
  )).rows[0]!.id;
  const token = `plink_${randomUUID()}`;
  await pool.query(
    `INSERT INTO payment_links (merchant_id, token, amount_fils, expires_at, created_by_type, created_by_id)
     VALUES ($1, $2, 8000, now() + interval '1 hour', 'merchant_session', $3)`,
    [merchantId, token, randomUUID()],
  );
  const simulator = createAcquirerSimulator(config);
  const keys: string[] = [];
  let calls = 0;
  const ambiguous = {
    authorize: simulator.authorize.bind(simulator),
    capture: async (req: Parameters<typeof simulator.capture>[0]) => {
      calls += 1;
      keys.push(req.idempotencyKey);
      const result = await simulator.capture(req);
      if (calls === 1) throw new Error("ambiguous capture outcome");
      return result;
    },
    refund: simulator.refund.bind(simulator),
  };
  const request = { token, card, idempotencyKey: randomUUID() };
  await assert.rejects(payPaymentLink(pool, ambiguous, settings, request), /ambiguous capture outcome/);
  const retry = await payPaymentLink(pool, ambiguous, settings, request);
  assert.equal(retry.statusCode, 200, JSON.stringify(retry.body));
  assert.equal(calls, 2);
  assert.equal(keys[0], keys[1]);
  const txns = await pool.query<{ n: string; status: string }>(
    `SELECT count(*)::text AS n, max(status) AS status FROM transactions WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(txns.rows[0]!.n, "1");
  assert.equal(txns.rows[0]!.status, "captured");
  const link = await pool.query<{ status: string }>(`SELECT status FROM payment_links WHERE token = $1`, [token]);
  assert.equal(link.rows[0]!.status, "paid");
});
