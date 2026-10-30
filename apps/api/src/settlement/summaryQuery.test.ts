import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { getSettlementSummary } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("summaryQuery.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

after(async () => {
  await pool.end();
});

test("summary sums captured_fils once when a transaction has two capture events", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Summary fanout ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, reference, acquirer_reference, occurred_at)
     VALUES ($1, 'captured', 10000, 10000, 'partials', $2, '2026-04-01T10:00:00Z')
     RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  );
  const transactionId = txn.rows[0]!.id;
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
     VALUES ($1, 'partially_captured', 4000, 'system', '2026-04-01T10:00:00Z'),
            ($1, 'captured', 6000, 'system', '2026-04-01T11:00:00Z')`,
    [transactionId],
  );

  const summary = await getSettlementSummary(pool, {
    merchantId,
    from: "2026-04-01",
    to: "2026-04-02",
  });
  assert.equal(summary.transactionCount, 1);
  assert.equal(summary.totalCapturedFils, 10_000);
});
