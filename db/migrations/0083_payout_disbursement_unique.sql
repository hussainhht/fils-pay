-- One settlement batch gets one disbursement row. Redeliveries and duplicate
-- payout paths were inserted again because settlement_batch_id was not unique.
-- Keep the earliest row per batch (first write wins, same as ON CONFLICT DO
-- NOTHING) and then enforce it.

DELETE FROM settlement_payout_disbursements AS extra
 USING settlement_payout_disbursements AS kept
 WHERE extra.settlement_batch_id = kept.settlement_batch_id
   AND (extra.created_at, extra.id) > (kept.created_at, kept.id);

CREATE UNIQUE INDEX uq_settlement_payout_disbursements_batch
    ON settlement_payout_disbursements (settlement_batch_id);
