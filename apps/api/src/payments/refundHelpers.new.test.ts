/**
 * Refund helper rules for ownership, captured headroom, conditional
 * refunded totals, and approval recovery. POST /v1/refunds stays 501.
 * Real migrated Postgres; requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";
import type { AcquirerRefundResult, AcquirerSimulator } from "../acquirer/types.js";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import { initiateMerchantRefund } from "../refunds/initiateMerchantRefund.js";
import { hashRequest } from "./idempotency.js";
import { processRefund } from "./processRefund.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("refundHelpers.new.test.ts requires DATABASE_URL (a migrated Postgres)");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 6 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

const VALID_CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

function countingAcquirer(calls: { n: number }): AcquirerSimulator {
  return {
    authorize() {
      throw new Error("not used");
    },
    capture() {
      throw new Error("not used");
    },
    async refund(req): Promise<AcquirerRefundResult> {
      calls.n += 1;
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
  };
}

async function merchantWithKey(label: string) {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Refund helper ${label} ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused-in-these-tests') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: user.rows[0]!.id, label });
  const key = await pool.query<{ id: string }>(
    `SELECT id FROM api_keys WHERE merchant_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [merchantId],
  );
  return {
    merchantId,
    rawKey: issued.rawKey,
    actor: { type: "merchant_api_key" as const, id: key.rows[0]!.id },
  };
}

async function capturedTransaction(rawKey: string, amountFils: number, captureFils?: number): Promise<string> {
  const authorizeRes = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils, card: VALID_CARD, reference: "refund-helper" },
  });
  assert.equal(authorizeRes.statusCode, 201, authorizeRes.body);
  const id = (authorizeRes.json() as { id: string }).id;
  const captureRes = await app.inject({
    method: "POST",
    url: `/v1/transactions/${id}/capture`,
    headers: { authorization: `Bearer ${rawKey}`, "idempotency-key": randomUUID() },
    payload: captureFils === undefined ? {} : { amountFils: captureFils },
  });
  assert.equal(captureRes.statusCode, 200, captureRes.body);
  return id;
}

test("POST /v1/refunds still returns 501", async () => {
  const merchant = await merchantWithKey("route-501");
  const res = await app.inject({
    method: "POST",
    url: "/v1/refunds",
    headers: { authorization: `Bearer ${merchant.rawKey}` },
    payload: {},
  });
  assert.equal(res.statusCode, 501, res.body);
  assert.equal(res.json().error, "not_implemented");
});

test("another merchant's transaction is a 404 and is not refunded", async () => {
  const owner = await merchantWithKey("owner");
  const other = await merchantWithKey("other");
  const transactionId = await capturedTransaction(owner.rawKey, 8_000);
  const calls = { n: 0 };

  await assert.rejects(
    () =>
      initiateMerchantRefund(pool, countingAcquirer(calls), {
        merchantId: other.merchantId,
        transactionId,
        idempotencyKey: randomUUID(),
        actor: other.actor,
      }),
    NotFoundError,
  );

  const direct = await processRefund(pool, countingAcquirer(calls), {
    transactionId,
    merchantId: other.merchantId,
    idempotencyKey: randomUUID(),
    actor: other.actor,
  });
  assert.equal(direct.statusCode, 404);
  assert.deepEqual(direct.body, { error: "transaction_not_found" });
  assert.equal(calls.n, 0);

  const refunds = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM refunds WHERE transaction_id = $1`,
    [transactionId],
  );
  assert.equal(refunds.rows[0]!.c, 0);
  const row = await pool.query<{ refunded_fils: string }>(
    `SELECT refunded_fils FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(Number(row.rows[0]!.refunded_fils), 0);
});

test("a partial capture cannot be refunded above the captured amount", async () => {
  const merchant = await merchantWithKey("captured-ceiling");
  const transactionId = await capturedTransaction(merchant.rawKey, 10_000, 4_000);
  const calls = { n: 0 };
  const result = await processRefund(pool, countingAcquirer(calls), {
    transactionId,
    merchantId: merchant.merchantId,
    amountFils: toFils(5_000),
    idempotencyKey: randomUUID(),
    actor: merchant.actor,
    reason: "ceiling",
  });
  assert.equal(result.statusCode, 422);
  assert.equal((result.body as { code: string }).code, "refund_exceeds_refundable");
  assert.equal((result.body as { refundableFils: number }).refundableFils, 4_000);
  assert.equal(calls.n, 0);
  const row = await pool.query<{ refunded_fils: string }>(
    `SELECT refunded_fils FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(Number(row.rows[0]!.refunded_fils), 0);
});

test("two concurrent refunds cannot exceed captured money and only one reaches the acquirer", async () => {
  const merchant = await merchantWithKey("concurrent");
  const transactionId = await capturedTransaction(merchant.rawKey, 4_000);
  const calls = { n: 0 };
  const acquirer = countingAcquirer(calls);
  const results = await Promise.all([
    processRefund(pool, acquirer, {
      transactionId,
      merchantId: merchant.merchantId,
      amountFils: toFils(3_000),
      idempotencyKey: randomUUID(),
      actor: merchant.actor,
    }),
    processRefund(pool, acquirer, {
      transactionId,
      merchantId: merchant.merchantId,
      amountFils: toFils(3_000),
      idempotencyKey: randomUUID(),
      actor: merchant.actor,
    }),
  ]);
  assert.deepEqual(results.map((result) => result.statusCode).sort(), [200, 422]);
  assert.equal(calls.n, 1);
  const row = await pool.query<{ refunded_fils: string }>(
    `SELECT refunded_fils FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(Number(row.rows[0]!.refunded_fils), 3_000);
  const refunds = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM refunds WHERE transaction_id = $1 AND status = 'succeeded'`,
    [transactionId],
  );
  assert.equal(refunds.rows[0]!.c, 1);
});

test("an omitted reason is stored as unspecified and the claim completes", async () => {
  const merchant = await merchantWithKey("reason");
  const transactionId = await capturedTransaction(merchant.rawKey, 2_000);
  const idempotencyKey = randomUUID();
  const result = await processRefund(pool, countingAcquirer({ n: 0 }), {
    transactionId,
    merchantId: merchant.merchantId,
    idempotencyKey,
    actor: merchant.actor,
  });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const refund = await pool.query<{ reason: string | null }>(
    `SELECT reason FROM refunds WHERE transaction_id = $1`,
    [transactionId],
  );
  assert.equal(refund.rows[0]!.reason, "unspecified");
  const claim = await pool.query<{ status: string }>(
    `SELECT status FROM idempotency_keys
      WHERE merchant_id = $1 AND endpoint = 'refunds.create' AND key = $2`,
    [merchant.merchantId, idempotencyKey],
  );
  assert.equal(claim.rows[0]!.status, "completed");
});

test("a stored approval is finalized once without calling the acquirer again", async () => {
  const merchant = await merchantWithKey("resume");
  const transactionId = await capturedTransaction(merchant.rawKey, 10_000);
  const amount = toFils(1_000);
  const idempotencyKey = randomUUID();
  const txn = await pool.query<{ amount_fils: string; captured_fils: string; acquirer_reference: string }>(
    `SELECT amount_fils::text, captured_fils::text, acquirer_reference FROM transactions WHERE id = $1`,
    [transactionId],
  );
  const fee = await pool.query<{ fee_fils: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)::text AS fee_fils
       FROM ledger_entries
      WHERE transaction_id = $1
        AND account_id = 'platform_fee_revenue'
        AND (direction = 'credit' OR description = 'capture: negotiated discount adjustment')`,
    [transactionId],
  );
  const pending = await pool.query<{ id: string }>(
    `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, status, acquirer_reference, reason, created_by_type, created_by_id)
     VALUES ($1, $2, $3, 'pending', $4, 'unspecified', 'merchant_api_key', $5)
     RETURNING id`,
    [transactionId, merchant.merchantId, amount, txn.rows[0]!.acquirer_reference, merchant.actor.id],
  );
  const requestHash = hashRequest({ transactionId, amountFils: amount, reason: null });
  await pool.query(
    `INSERT INTO idempotency_keys (merchant_id, endpoint, key, request_hash, status, response_body, resource_id)
     VALUES ($1, 'refunds.create', $2, $3, 'in_progress', $4::jsonb, $5)`,
    [
      merchant.merchantId,
      idempotencyKey,
      requestHash,
      JSON.stringify({
        externalOutcome: "approved",
        acquirerReference: "acq-recovered",
        capturedFils: Number(txn.rows[0]!.captured_fils),
        feeChargedFils: Number(fee.rows[0]!.fee_fils),
        amountAuthorized: Number(txn.rows[0]!.amount_fils),
        requestedAmount: amount,
      }),
      pending.rows[0]!.id,
    ],
  );
  const calls = { n: 0 };
  const result = await processRefund(pool, countingAcquirer(calls), {
    transactionId,
    merchantId: merchant.merchantId,
    amountFils: amount,
    idempotencyKey,
    actor: merchant.actor,
  });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(calls.n, 0);
  assert.equal((result.body as { acquirerReference: string }).acquirerReference, "acq-recovered");
  const refunds = await pool.query<{ c: number; status: string }>(
    `SELECT COUNT(*)::int AS c, MIN(status) AS status FROM refunds WHERE transaction_id = $1`,
    [transactionId],
  );
  assert.equal(refunds.rows[0]!.c, 1);
  assert.equal(refunds.rows[0]!.status, "succeeded");
  const row = await pool.query<{ refunded_fils: string }>(
    `SELECT refunded_fils FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(Number(row.rows[0]!.refunded_fils), 1_000);
  const claim = await pool.query<{ status: string }>(
    `SELECT status FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
    [merchant.merchantId, idempotencyKey],
  );
  assert.equal(claim.rows[0]!.status, "completed");
});

test("a database failure after approval does not retry the acquirer or delete the claim", async () => {
  const merchant = await merchantWithKey("cap-after-approval");
  const transactionId = await capturedTransaction(merchant.rawKey, 4_000);
  const calls = { n: 0 };
  const acquirer: AcquirerSimulator = {
    authorize() {
      throw new Error("not used");
    },
    capture() {
      throw new Error("not used");
    },
    async refund(req): Promise<AcquirerRefundResult> {
      calls.n += 1;
      await pool.query(`UPDATE transactions SET refunded_fils = captured_fils WHERE id = $1`, [transactionId]);
      return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
    },
  };
  const idempotencyKey = randomUUID();
  const input = {
    transactionId,
    merchantId: merchant.merchantId,
    amountFils: toFils(3_000),
    idempotencyKey,
    actor: merchant.actor,
  };
  await assert.rejects(() => processRefund(pool, acquirer, input), /captured cap/);
  assert.equal(calls.n, 1);

  const quiet = countingAcquirer({ n: 0 });
  const retryCalls = { n: 0 };
  quiet.refund = async (req) => {
    retryCalls.n += 1;
    return { outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 };
  };
  await assert.rejects(() => processRefund(pool, quiet, input), /captured cap/);
  assert.equal(retryCalls.n, 0);

  const claim = await pool.query<{ status: string; response_body: { externalOutcome?: string } }>(
    `SELECT status, response_body FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
    [merchant.merchantId, idempotencyKey],
  );
  assert.equal(claim.rows.length, 1);
  assert.equal(claim.rows[0]!.status, "in_progress");
  assert.equal(claim.rows[0]!.response_body.externalOutcome, "approved");
  const refund = await pool.query<{ status: string; amount_fils: string }>(
    `SELECT status, amount_fils::text FROM refunds WHERE transaction_id = $1`,
    [transactionId],
  );
  assert.equal(refund.rows.length, 1);
  assert.equal(refund.rows[0]!.status, "pending");
  assert.equal(refund.rows[0]!.amount_fils, "3000");
  const row = await pool.query<{ refunded_fils: string; captured_fils: string }>(
    `SELECT refunded_fils::text, captured_fils::text FROM transactions WHERE id = $1`,
    [transactionId],
  );
  assert.equal(row.rows[0]!.refunded_fils, row.rows[0]!.captured_fils);
});

test("an in-progress claim with no stored approval is not retried or deleted", async () => {
  const merchant = await merchantWithKey("unknown-outcome");
  const transactionId = await capturedTransaction(merchant.rawKey, 5_000);
  const amount = toFils(2_000);
  const idempotencyKey = randomUUID();
  const txn = await pool.query<{ acquirer_reference: string }>(
    `SELECT acquirer_reference FROM transactions WHERE id = $1`,
    [transactionId],
  );
  const pending = await pool.query<{ id: string }>(
    `INSERT INTO refunds (transaction_id, merchant_id, amount_fils, status, acquirer_reference, reason, created_by_type, created_by_id)
     VALUES ($1, $2, $3, 'pending', $4, 'unspecified', 'merchant_api_key', $5)
     RETURNING id`,
    [transactionId, merchant.merchantId, amount, txn.rows[0]!.acquirer_reference, merchant.actor.id],
  );
  await pool.query(
    `INSERT INTO idempotency_keys (merchant_id, endpoint, key, request_hash, status, resource_id)
     VALUES ($1, 'refunds.create', $2, $3, 'in_progress', $4)`,
    [
      merchant.merchantId,
      idempotencyKey,
      hashRequest({ transactionId, amountFils: amount, reason: null }),
      pending.rows[0]!.id,
    ],
  );
  const calls = { n: 0 };
  await assert.rejects(
    () =>
      processRefund(pool, countingAcquirer(calls), {
        transactionId,
        merchantId: merchant.merchantId,
        amountFils: amount,
        idempotencyKey,
        actor: merchant.actor,
      }),
    ConflictError,
  );
  assert.equal(calls.n, 0);
  const claim = await pool.query<{ status: string }>(
    `SELECT status FROM idempotency_keys WHERE merchant_id = $1 AND key = $2`,
    [merchant.merchantId, idempotencyKey],
  );
  assert.equal(claim.rows.length, 1);
  assert.equal(claim.rows[0]!.status, "in_progress");
  const refund = await pool.query<{ status: string }>(
    `SELECT status FROM refunds WHERE id = $1`,
    [pending.rows[0]!.id],
  );
  assert.equal(refund.rows[0]!.status, "pending");
});
