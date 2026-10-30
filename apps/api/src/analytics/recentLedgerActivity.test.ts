import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { getRecentLedgerActivity } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("recentLedgerActivity.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

after(async () => {
  await pool.end();
});

async function insertPair(merchantId: string, occurredAt: string, description: string): Promise<void> {
  const entryGroupId = randomUUID();
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'card_scheme_clearing', 'debit', 100, $3, $4),
            ($1, $2, 'merchant_payable', 'credit', 100, $3, $4)`,
    [entryGroupId, merchantId, occurredAt, description],
  );
}

test("recent ledger activity excludes the exclusive Bahrain end date", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Ledger window ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await insertPair(merchantId, "2026-09-01T00:00:00+03:00", "start");
  await insertPair(merchantId, "2026-09-01T23:00:00+03:00", "inside");
  await insertPair(merchantId, "2026-09-02T00:00:00+03:00", "end-midnight");
  await insertPair(merchantId, "2026-09-02T12:00:00+03:00", "end-afternoon");

  const window = await getRecentLedgerActivity(pool, {
    merchantId,
    from: "2026-09-01",
    to: "2026-09-02",
  });
  assert.deepEqual(
    window.points.map((point) => point.description).sort(),
    ["inside", "inside", "start", "start"],
  );

  const empty = await getRecentLedgerActivity(pool, {
    merchantId,
    from: "2026-09-02",
    to: "2026-09-02",
  });
  assert.deepEqual(empty.points, []);
});
