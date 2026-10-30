/**
 * Closed-period guard and effective-schedule fee reversal for manual credits.
 * Requires DATABASE_URL and a migrated database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createCreditRequest } from "./credits.js";
import { AppError } from "../lib/errors.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("credits.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(mdrBps = 250): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, $2) RETURNING id`,
    [`Credit New ${randomUUID()}`, mdrBps],
  );
  return result.rows[0]!.id;
}

async function createAdmin(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', $2, 'finance') RETURNING id`,
    [`credit-new-${randomUUID()}@admin.test`, `Credit New ${randomUUID().slice(0, 8)}`],
  );
  return result.rows[0]!.id;
}

function creditBody(effectiveDate: string, extra: Record<string, unknown> = {}) {
  return {
    baseAmountFils: 20_000,
    reasonCode: "goodwill",
    effectiveDate,
    ...extra,
  };
}

test("a credit is rejected when its date is covered by a closed or paid batch", async () => {
  const merchantId = await createMerchant();
  const adminUserId = await createAdmin();
  await pool.query(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status)
     VALUES ($1, '2020-03-15', 'closed'), ($1, '2020-04-01', 'paid')`,
    [merchantId],
  );

  for (const effectiveDate of ["2020-03-15", "2020-03-14", "2020-04-01"]) {
    await assert.rejects(
      () =>
        createCreditRequest(pool, {
          merchantId,
          adminUserId,
          body: creditBody(effectiveDate),
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.statusCode, 409);
        assert.equal(err.code, "settlement_period_closed");
        return true;
      },
    );
  }

  const legs = await pool.query(`SELECT 1 FROM ledger_entries WHERE merchant_id = $1`, [merchantId]);
  assert.equal(legs.rowCount, 0);

  const after = await createCreditRequest(pool, {
    merchantId,
    adminUserId,
    body: creditBody("2020-04-02"),
  });
  assert.equal(after.status, "posted");

  const openMerchant = await createMerchant();
  await pool.query(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status) VALUES ($1, '2020-06-01', 'open')`,
    [openMerchant],
  );
  const posted = await createCreditRequest(pool, {
    merchantId: openMerchant,
    adminUserId,
    body: creditBody("2020-06-01"),
  });
  assert.equal(posted.status, "posted");
});

test("a fee reversal uses the schedule in force on the effective date", async () => {
  const merchantId = await createMerchant(250);
  const adminUserId = await createAdmin();
  await pool.query(
    `INSERT INTO fee_schedules (merchant_id, mdr_bps, effective_from) VALUES ($1, 225, '2026-08-01T00:00:00Z')`,
    [merchantId],
  );

  const onSchedule = await createCreditRequest(pool, {
    merchantId,
    adminUserId,
    body: creditBody("2026-10-30", { reverseFee: true }),
  });
  assert.equal(onSchedule.feeReversalFils, 450, "20.000 BD at the 225 bps schedule, not the 250 column");

  const beforeSchedule = await createCreditRequest(pool, {
    merchantId,
    adminUserId,
    body: creditBody("2026-07-01", { reverseFee: true }),
  });
  assert.equal(beforeSchedule.feeReversalFils, 500, "before the schedule, fall back to merchants.mdr_bps");
});
