-- BUG-014 regression checks. Run only against a disposable migrated database:
-- psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f Evidence/implementation/migrations-validation.sql
-- All fixture rows and the materialized-view refresh roll back on completion.
BEGIN;

DO $validation$
DECLARE
    merchant_uuid UUID := gen_random_uuid();
    transaction_uuid UUID := gen_random_uuid();
    refund_uuid UUID := gen_random_uuid();
    batch_uuid UUID := gen_random_uuid();
    unbatched_event BIGINT;
    batched_event BIGINT;
    row_count BIGINT;
    summary_row RECORD;
BEGIN
    IF (SELECT COUNT(*) FROM chart_of_accounts
         WHERE id IN ('fx_rounding_difference', 'chargeback_suspense')
           AND kind = 'asset') <> 2 THEN
        RAISE EXCEPTION '0055: expected both clearing asset accounts';
    END IF;

    INSERT INTO merchants (id, display_name, test_mode)
    VALUES (merchant_uuid, 'BUG-014 disposable regression', true);
    INSERT INTO transactions
        (id, merchant_id, status, amount_fils, captured_fils, acquirer_reference)
    VALUES (transaction_uuid, merchant_uuid, 'captured', 1000, 1000, 'BUG-014-authorized');
    INSERT INTO settlement_batches (id, merchant_id, batch_date)
    VALUES (batch_uuid, merchant_uuid, DATE '2026-01-01');

    INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type)
    VALUES (transaction_uuid, 'captured', 500, 'system')
    RETURNING id INTO unbatched_event;
    INSERT INTO transaction_events
        (transaction_id, event_type, amount_fils, actor_type, settlement_batch_id)
    VALUES (transaction_uuid, 'captured', 500, 'system', batch_uuid)
    RETURNING id INTO batched_event;
    INSERT INTO transaction_events (transaction_id, event_type, actor_type)
    VALUES (transaction_uuid, 'authorized', 'system');

    SELECT COUNT(*) INTO row_count FROM v_unbatched_capture_events
     WHERE merchant_id = merchant_uuid;
    IF row_count <> 1 OR NOT EXISTS (
        SELECT 1 FROM v_unbatched_capture_events WHERE event_id = unbatched_event
    ) OR EXISTS (
        SELECT 1 FROM v_unbatched_capture_events WHERE event_id = batched_event
    ) THEN
        RAISE EXCEPTION '0054: expected only the capture without a settlement batch';
    END IF;

    IF refund_uuid = transaction_uuid THEN
        RAISE EXCEPTION 'Regression requires distinct refund and transaction IDs';
    END IF;
    INSERT INTO refunds
        (id, transaction_id, merchant_id, amount_fils, fee_reversed_fils,
         status, acquirer_reference, created_by_type, created_by_id, occurred_at)
    VALUES
        (refund_uuid, transaction_uuid, merchant_uuid, 250, 6,
         'succeeded', 'BUG-014-success', 'merchant_session', gen_random_uuid(),
         TIMESTAMPTZ '2026-01-01 23:30:00+00'),
        (gen_random_uuid(), transaction_uuid, merchant_uuid, 100, 2,
         'failed', 'BUG-014-failure', 'merchant_session', gen_random_uuid(),
         TIMESTAMPTZ '2026-01-01 23:30:00+00');
    REFRESH MATERIALIZED VIEW refund_merchant_summary;

    SELECT COUNT(*) INTO row_count FROM refund_merchant_summary
     WHERE merchant_id = merchant_uuid;
    SELECT * INTO summary_row FROM refund_merchant_summary
     WHERE merchant_id = merchant_uuid;
    IF row_count <> 1 OR summary_row.refund_count <> 1
       OR summary_row.total_refunded_fils <> 250
       OR summary_row.total_fee_reversed_fils <> 6
       OR summary_row.original_captured_fils <> 1000
       OR summary_row.business_date <> TIMESTAMP '2026-01-02 00:00:00' THEN
        RAISE EXCEPTION '0072: expected successful refund joined by transaction_id and Bahrain day';
    END IF;

    RAISE NOTICE 'BUG-014 regression checks passed';
END;
$validation$;

ROLLBACK;
