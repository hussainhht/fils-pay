import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { getReconciliationReport } from "./query.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reconciliation.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

after(async () => {
  await pool.end();
});

test("a paid batch inside the window is not subtracted twice", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Reconcile payout ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  await pool.query(
    `INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils)
     VALUES ($1, '2026-05-01', 'paid', 10000, 250, 9750)`,
    [merchantId],
  );
  const when = "2026-05-01T12:00:00+03:00";
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'merchant_payable', 'credit', 9750, $3, 'capture'),
            ($1, $2, 'card_scheme_clearing', 'debit', 9750, $3, 'capture')`,
    [randomUUID(), merchantId, when],
  );
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'merchant_payable', 'debit', 9750, $3, 'settlement payout: batch paid'),
            ($1, $2, 'platform_cash', 'credit', 9750, $3, 'settlement payout: batch paid')`,
    [randomUUID(), merchantId, when],
  );

  const report = await getReconciliationReport(pool, {
    merchantId,
    from: "2026-05-01",
    to: "2026-05-02",
  });
  assert.equal(report.ledgerMerchantPayableNetFils, 9750);
  assert.equal(report.settlementNetPayoutFils, 9750);
  assert.equal(report.gapFils, 0);
  assert.equal(report.explained, true);
});

test("pending net uses the fee stored on the capture event", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Reconcile fee ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, reference, acquirer_reference, occurred_at)
     VALUES ($1, 'captured', 10000, 10000, 'sched', $2, '2026-05-03T10:00:00+03:00')
     RETURNING id`,
    [merchantId, `acq_${randomUUID()}`],
  );
  await pool.query(
    `INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at, metadata)
     VALUES ($1, 'captured', 10000, 'system', '2026-05-03T10:00:00+03:00', $2::jsonb)`,
    [txn.rows[0]!.id, JSON.stringify({ feeFils: 200 })],
  );
  await pool.query(
    `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
     VALUES ($1, $2, 'merchant_payable', 'credit', 9800, $3, 'capture'),
            ($1, $2, 'card_scheme_clearing', 'debit', 9800, $3, 'capture')`,
    [randomUUID(), merchantId, "2026-05-03T10:00:00+03:00"],
  );

  const report = await getReconciliationReport(pool, {
    merchantId,
    from: "2026-05-03",
    to: "2026-05-04",
  });
  assert.equal(report.pendingUnbatchedFils, 9800);
  assert.equal(report.gapFils, 0);
});
