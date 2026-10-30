import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyCaptureDiscountAdjustment } from "./discountAdjustment.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("discountAdjustment.new.test.ts requires DATABASE_URL");

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
test.after(() => pool.end());

async function rebateTotal(transactionId: string): Promise<number> {
  const row = await pool.query<{ n: string; fils: string | null }>(
    `SELECT count(*)::text AS n, COALESCE(sum(amount_fils), 0)::text AS fils
       FROM ledger_entries
      WHERE transaction_id = $1 AND direction = 'credit'
        AND description = 'capture: negotiated discount adjustment'`,
    [transactionId],
  );
  return Number(row.rows[0]!.fils);
}

test("a zero-rebate capture does not let a later replay post the positive rebate again", async () => {
  const merchantId = (await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps, onboarding_status)
     VALUES ('Zero then positive', 250, 1000, 'approved') RETURNING id`,
  )).rows[0]!.id;
  const transactionId = (await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 1001, 1001, $2) RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  )).rows[0]!.id;
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, metadata)
     VALUES ($1, 'partially_captured', 1, 'system', '{"feeFils":0}'),
            ($1, 'captured', 1000, 'system', '{"feeFils":25}')`,
    [transactionId],
  );

  await applyCaptureDiscountAdjustment(pool, { merchantId, transactionId });
  const once = await rebateTotal(transactionId);
  await applyCaptureDiscountAdjustment(pool, { merchantId, transactionId });
  assert.equal(await rebateTotal(transactionId), once);
  assert.equal(once, 3);
});

test("a discount adjustment for another merchant posts nothing", async () => {
  const owner = (await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps, onboarding_status)
     VALUES ('Owner', 275, 1250, 'approved') RETURNING id`,
  )).rows[0]!.id;
  const other = (await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, negotiated_discount_bps, onboarding_status)
     VALUES ('Other', 275, 1250, 'approved') RETURNING id`,
  )).rows[0]!.id;
  const transactionId = (await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 602, 602, $2) RETURNING id`,
    [owner, `acq_${randomUUID()}`],
  )).rows[0]!.id;
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, metadata)
     VALUES ($1, 'captured', 602, 'system', '{"feeFils":17}')`,
    [transactionId],
  );

  await applyCaptureDiscountAdjustment(pool, { merchantId: other, transactionId });
  assert.equal(await rebateTotal(transactionId), 0);
});
