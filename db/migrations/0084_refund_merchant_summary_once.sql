-- Replaces 0072_refund_merchant_summary forward (0072 may already be applied).
-- original_captured_fils counted t.captured_fils once per refund row, so two
-- partial refunds on the same transaction doubled the capture total.

DROP MATERIALIZED VIEW IF EXISTS refund_merchant_summary;

CREATE MATERIALIZED VIEW refund_merchant_summary AS
SELECT
    s.merchant_id,
    s.business_date,
    SUM(s.refund_count)::bigint       AS refund_count,
    SUM(s.amount_fils)                AS total_refunded_fils,
    SUM(s.fee_reversed_fils)          AS total_fee_reversed_fils,
    SUM(t.captured_fils)              AS original_captured_fils
FROM (
    SELECT merchant_id,
           transaction_id,
           date_trunc('day', occurred_at AT TIME ZONE 'Asia/Bahrain') AS business_date,
           COUNT(*)                 AS refund_count,
           SUM(amount_fils)         AS amount_fils,
           SUM(fee_reversed_fils)   AS fee_reversed_fils
      FROM refunds
     WHERE status = 'succeeded'
     GROUP BY merchant_id, transaction_id, date_trunc('day', occurred_at AT TIME ZONE 'Asia/Bahrain')
) s
JOIN transactions t ON t.id = s.transaction_id
GROUP BY s.merchant_id, s.business_date;

CREATE UNIQUE INDEX idx_refund_merchant_summary_pk
    ON refund_merchant_summary (merchant_id, business_date);
