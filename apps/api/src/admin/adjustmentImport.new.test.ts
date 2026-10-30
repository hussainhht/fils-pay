/**
 * Re-uploading the same adjustment rows must not post a second time.
 * Requires DATABASE_URL and migration 0082.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { applyAdjustmentImport } from "./adjustmentImport.js";
import { AppError } from "../lib/errors.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adjustmentImport.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

test.after(async () => {
  await pool.end();
});

test("the same parsed rows are not posted twice, regardless of filename", async () => {
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', 'Import Idem', 'finance') RETURNING id`,
    [`adj-idem-${randomUUID()}@admin.test`],
  );
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
     VALUES ($1, 250, 'active', false) RETURNING id`,
    [`adj-idem-${randomUUID()}`],
  );
  const adminUserId = admin.rows[0]!.id;
  const merchantId = merchant.rows[0]!.id;
  const rows = [{ merchantId, amount: "4.75", reason: "statement correction" }];

  const first = await applyAdjustmentImport(pool, {
    adminUserId,
    originalFilename: "corrections.csv",
    rows,
  });
  assert.equal(first.totalPostedFils, 4750);

  await assert.rejects(
    () =>
      applyAdjustmentImport(pool, {
        adminUserId,
        originalFilename: "corrections-again.csv",
        rows,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 409);
      assert.equal(err.code, "adjustment_import_duplicate");
      return true;
    },
  );

  const groups = await pool.query<{ n: string }>(
    `SELECT COUNT(DISTINCT entry_group_id)::text AS n FROM ledger_entries WHERE merchant_id = $1`,
    [merchantId],
  );
  assert.equal(groups.rows[0]!.n, "1");

  const secondFile = await applyAdjustmentImport(pool, {
    adminUserId,
    originalFilename: "corrections.csv",
    rows: [{ merchantId, amount: "1.000", reason: "different row" }],
  });
  assert.equal(secondFile.totalPostedFils, 1000);
});
