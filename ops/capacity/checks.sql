-- Read-only; run after each stage and again after backlog drain.
-- psql -v merchant_id=<fixture metadata UUID> -f checks.sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SELECT status, count(*) AS links FROM payment_links
 WHERE merchant_id = :'merchant_id'::uuid GROUP BY status;
SELECT count(*) AS invalid_paid_links FROM payment_links p
 LEFT JOIN transactions t ON t.id = p.transaction_id AND t.merchant_id = p.merchant_id
 WHERE p.merchant_id = :'merchant_id'::uuid AND p.status = 'paid'
 AND (t.id IS NULL OR t.status <> 'captured' OR t.captured_fils <> 1000);
SELECT count(*) AS duplicate_references FROM (
 SELECT reference FROM transactions WHERE merchant_id = :'merchant_id'::uuid
 GROUP BY reference HAVING count(*) > 1
) d;
SELECT count(*) AS unbalanced_groups FROM (
 SELECT entry_group_id FROM ledger_entries WHERE entry_group_id IN (
   SELECT entry_group_id FROM ledger_entries WHERE merchant_id = :'merchant_id'::uuid)
 GROUP BY entry_group_id HAVING sum(CASE WHEN direction = 'debit' THEN amount_fils ELSE -amount_fils END) <> 0
) d;
SELECT t.status, h.status AS hold_status, count(*) FROM transactions t
 JOIN holds h ON h.transaction_id = t.id
 WHERE t.merchant_id = :'merchant_id'::uuid GROUP BY t.status, h.status;
SELECT count(DISTINCT p.id) AS reopened_links_with_live_authorization
 FROM payment_links p
 JOIN idempotency_keys k ON k.merchant_id = p.merchant_id
   AND k.endpoint = 'transactions.authorize'
   AND k.key LIKE 'paylink:' || p.id::text || ':%:authorize'
 JOIN transactions t ON t.id = k.resource_id AND t.merchant_id = p.merchant_id
 JOIN holds h ON h.transaction_id = t.id
 WHERE p.merchant_id = :'merchant_id'::uuid AND p.status = 'active'
   AND t.status = 'authorized' AND h.status = 'active';
SELECT count(*) AS duplicate_capture_events FROM (
 SELECT aggregate_id FROM outbox_events
 WHERE event_type = 'transaction.captured' AND payload->>'merchantId' = :'merchant_id'
 GROUP BY aggregate_id HAVING count(*) > 1
) d;
SELECT sum(captured_fils) AS captured_fils, count(*) FILTER (WHERE captured_fils > 0) AS captured_transactions
 FROM transactions WHERE merchant_id = :'merchant_id'::uuid;
SELECT sum(captured_gross_fils) AS reported_fils, sum(captured_count) AS reported_captures
 FROM merchant_daily_volume WHERE merchant_id = :'merchant_id'::uuid;
SELECT count(*) AS reporting_pending_events, min(e.created_at) AS oldest_pending
 FROM outbox_events e WHERE e.payload->>'merchantId' = :'merchant_id'
 AND e.event_type IN ('transaction.captured', 'transaction.voided', 'refund.succeeded', 'settlement.batch_closed')
 AND e.id > COALESCE((SELECT last_processed_id FROM reporting_outbox_cursor WHERE consumer_name = 'reporting_worker'), 0);
SELECT w.status, count(*) FROM webhook_deliveries w JOIN outbox_events e ON e.id = w.outbox_event_id
 WHERE e.payload->>'merchantId' = :'merchant_id' GROUP BY w.status;
SELECT state, wait_event_type, wait_event, count(*), max(now() - xact_start) AS oldest_transaction
 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
 GROUP BY state, wait_event_type, wait_event;
SELECT count(*) AS waiting_locks FROM pg_locks WHERE NOT granted;
COMMIT;
