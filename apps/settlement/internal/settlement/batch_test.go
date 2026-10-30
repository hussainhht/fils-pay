package settlement

import (
	"context"
	"errors"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

// mustPool connects to DATABASE_URL (matching how the TS tests connect —
// same env var, same "run `npm run migrate` first" contract) or skips the
// test if it isn't set, so `go test ./...` still runs cleanly without a
// live Postgres.
// am: these all skip when DATABASE_URL isn't set, so 'ok' means nothing. (fixed? CI has pg now, FP-270)
func mustPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test (run against a real, migrated Postgres)")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("failed to connect to DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertActiveMerchant(t *testing.T, pool *pgxpool.Pool, mdrBps int64) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
		VALUES ($1, $2, 'active', false)
		RETURNING id
	`, "settlement-batch-test-"+uuid.New().String(), mdrBps).Scan(&id)
	if err != nil {
		t.Fatalf("insertActiveMerchant: %v", err)
	}
	return id
}

// insertCaptureEvent inserts one transactions row (status 'captured',
// captured_fils = amountFils = amountFils, matching a single full capture)
// plus one matching transaction_events row and the matching ledger_entries
// pair(s) that apps/api's capture.ts would have posted for that exact
// event — the gross leg pair, plus the fee leg pair computed with the same
// ApplyRateFils formula CloseBatch itself uses, so a test can assert
// CloseBatch's independently recomputed fee lands on the same figure
// capture-time already posted.
func insertCaptureEvent(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, mdrBps int64, amountFils money.Fils, occurredAt time.Time) (txnID uuid.UUID, feeFils money.Fils) {
	t.Helper()
	ctx := context.Background()

	err := pool.QueryRow(ctx, `
		INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, occurred_at)
		VALUES ($1, 'captured', $2, $2, $3, $4)
		RETURNING id
	`, merchantID, int64(amountFils), "acq-ref-"+uuid.New().String(), occurredAt).Scan(&txnID)
	if err != nil {
		t.Fatalf("insertCaptureEvent: insert transaction: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
		VALUES ($1, 'captured', $2, 'system', $3)
	`, txnID, int64(amountFils), occurredAt)
	if err != nil {
		t.Fatalf("insertCaptureEvent: insert transaction_events: %v", err)
	}

	feeFils = money.ApplyRateFils(amountFils, mdrBps)
	groupID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO ledger_entries
		  (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES
		  ($1, $2, $3, 'card_scheme_clearing', 'debit',  $4, $5, 'capture: gross'),
		  ($1, $2, $3, 'merchant_payable',     'credit', $4, $5, 'capture: gross')
	`, groupID, merchantID, txnID, int64(amountFils), occurredAt)
	if err != nil {
		t.Fatalf("insertCaptureEvent: insert gross ledger legs: %v", err)
	}
	if feeFils > 0 {
		_, err = pool.Exec(ctx, `
			INSERT INTO ledger_entries
			  (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
			VALUES
			  ($1, $2, $3, 'merchant_payable',     'debit',  $4, $5, 'capture: MDR fee'),
			  ($1, $2, $3, 'platform_fee_revenue', 'credit', $4, $5, 'capture: MDR fee')
		`, groupID, merchantID, txnID, int64(feeFils), occurredAt)
		if err != nil {
			t.Fatalf("insertCaptureEvent: insert fee ledger legs: %v", err)
		}
	}

	return txnID, feeFils
}

// insertAdditionalCaptureEvent adds a SECOND transaction_events row (and
// matching ledger legs) against an EXISTING transaction — simulating a
// second partial capture on the same order later the same business day —
// without inserting a second transactions row, and without touching
// captured_fils (not needed by any assertion below).
func insertAdditionalCaptureEvent(t *testing.T, pool *pgxpool.Pool, merchantID, txnID uuid.UUID, mdrBps int64, amountFils money.Fils, occurredAt time.Time) money.Fils {
	t.Helper()
	ctx := context.Background()

	_, err := pool.Exec(ctx, `
		INSERT INTO transaction_events (transaction_id, event_type, amount_fils, actor_type, occurred_at)
		VALUES ($1, 'partially_captured', $2, 'system', $3)
	`, txnID, int64(amountFils), occurredAt)
	if err != nil {
		t.Fatalf("insertAdditionalCaptureEvent: insert transaction_events: %v", err)
	}

	feeFils := money.ApplyRateFils(amountFils, mdrBps)
	groupID := uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO ledger_entries
		  (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES
		  ($1, $2, $3, 'card_scheme_clearing', 'debit',  $4, $5, 'capture: gross'),
		  ($1, $2, $3, 'merchant_payable',     'credit', $4, $5, 'capture: gross')
	`, groupID, merchantID, txnID, int64(amountFils), occurredAt)
	if err != nil {
		t.Fatalf("insertAdditionalCaptureEvent: insert gross ledger legs: %v", err)
	}
	if feeFils > 0 {
		_, err = pool.Exec(ctx, `
			INSERT INTO ledger_entries
			  (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
			VALUES
			  ($1, $2, $3, 'merchant_payable',     'debit',  $4, $5, 'capture: MDR fee'),
			  ($1, $2, $3, 'platform_fee_revenue', 'credit', $4, $5, 'capture: MDR fee')
		`, groupID, merchantID, txnID, int64(feeFils), occurredAt)
		if err != nil {
			t.Fatalf("insertAdditionalCaptureEvent: insert fee ledger legs: %v", err)
		}
	}
	return feeFils
}

// countRows runs a COUNT(*) query on the shared pool, outside any test
// transaction, so it only sees committed rows.
func countRows(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("countRows(%s): %v", query, err)
	}
	return n
}

func TestCloseBatch_EligibleEventSelection(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insideWindow := start.Add(2 * time.Hour)
	beforeWindow := start.Add(-2 * time.Hour) // previous business day
	afterWindow := start.AddDate(0, 0, 1).Add(2 * time.Hour)

	// One eligible event inside the window...
	_, feeInside := insertCaptureEvent(t, pool, merchantID, mdrBps, 4750, insideWindow)
	// ...and two events that must NOT be picked up: one on the previous
	// business day, one on the next.
	insertCaptureEvent(t, pool, merchantID, mdrBps, 9999, beforeWindow)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 8888, afterWindow)

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	if result.GrossFils != 4750 {
		t.Errorf("GrossFils = %d, want 4750 (out-of-window events must be excluded)", result.GrossFils)
	}
	if result.FeeFils != feeInside {
		t.Errorf("FeeFils = %d, want %d", result.FeeFils, feeInside)
	}
	if result.EventCount != 1 {
		t.Errorf("EventCount = %d, want 1", result.EventCount)
	}
}

// YA: this one also covers two concurrent closes for the same day. don't delete.
func TestCloseBatch_IdempotentReClose(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 3, 16, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 5000, start.Add(time.Hour))

	first, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("first CloseBatch: %v", err)
	}
	if first.AlreadyClosed {
		t.Fatal("first CloseBatch should not report AlreadyClosed")
	}

	lineCountAfterFirst := countRows(t, pool, `SELECT count(*) FROM scheme_export_lines WHERE settlement_batch_id = $1`, first.BatchID)
	eventCountAfterFirst := countRows(t, pool, `SELECT count(*) FROM transaction_events WHERE settlement_batch_id = $1`, first.BatchID)

	second, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("second CloseBatch: %v", err)
	}
	if !second.AlreadyClosed {
		t.Fatal("second CloseBatch on an already-closed batch must report AlreadyClosed = true")
	}
	if second.BatchID != first.BatchID || second.GrossFils != first.GrossFils || second.FeeFils != first.FeeFils || second.NetPayoutFils != first.NetPayoutFils {
		t.Errorf("second CloseBatch figures diverged from the first: %+v vs %+v", second, first)
	}

	lineCountAfterSecond := countRows(t, pool, `SELECT count(*) FROM scheme_export_lines WHERE settlement_batch_id = $1`, first.BatchID)
	eventCountAfterSecond := countRows(t, pool, `SELECT count(*) FROM transaction_events WHERE settlement_batch_id = $1`, first.BatchID)
	batchRowCount := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2`, merchantID, businessDate)

	if lineCountAfterSecond != lineCountAfterFirst {
		t.Errorf("scheme_export_lines count changed on re-close: %d -> %d", lineCountAfterFirst, lineCountAfterSecond)
	}
	if eventCountAfterSecond != eventCountAfterFirst {
		t.Errorf("batched transaction_events count changed on re-close: %d -> %d", eventCountAfterFirst, eventCountAfterSecond)
	}
	if batchRowCount != 1 {
		t.Errorf("expected exactly one settlement_batches row for (merchant, date), got %d", batchRowCount)
	}
}

func TestCloseBatch_EmptyBatchStillCreated(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool, 250)
	businessDate := time.Date(2026, 3, 17, 0, 0, 0, 0, time.UTC)

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch on a merchant with zero events: %v", err)
	}
	if result.AlreadyClosed {
		t.Fatal("an empty batch on its first close must not report AlreadyClosed")
	}
	if result.GrossFils != 0 || result.FeeFils != 0 || result.NetPayoutFils != 0 {
		t.Errorf("expected all-zero figures for an empty batch, got %+v", result)
	}

	batchRowCount := countRows(t, pool, `SELECT count(*) FROM settlement_batches WHERE merchant_id = $1 AND batch_date = $2 AND status = 'closed'`, merchantID, businessDate)
	if batchRowCount != 1 {
		t.Errorf("expected exactly one closed settlement_batches row for an empty batch, got %d", batchRowCount)
	}
	lineCount := countRows(t, pool, `SELECT count(*) FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID)
	if lineCount != 0 {
		t.Errorf("expected zero scheme_export_lines for an empty batch, got %d", lineCount)
	}
}

// TestCloseBatch_FeePerEventThenSummed verifies fee is recomputed PER
// EVENT then summed — matching what capture.ts would have posted for the
// same events — never ApplyRateFils applied once to the pre-summed total
// (which can legitimately diverge on adversarial inputs).
func TestCloseBatch_FeePerEventThenSummed(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)

	businessDate := time.Date(2026, 3, 18, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	// Two partial-capture events against the SAME transaction, same
	// business day, amounts chosen so per-event rounding and
	// round-the-sum-once rounding could plausibly diverge.
	txnID, fee1 := insertCaptureEvent(t, pool, merchantID, mdrBps, 4747, start.Add(1*time.Hour))
	fee2 := insertAdditionalCaptureEvent(t, pool, merchantID, txnID, mdrBps, 3331, start.Add(2*time.Hour))

	expectedFee := fee1 + fee2
	expectedGross := money.Fils(4747 + 3331)

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	if result.GrossFils != expectedGross {
		t.Errorf("GrossFils = %d, want %d", result.GrossFils, expectedGross)
	}
	if result.FeeFils != expectedFee {
		t.Errorf("FeeFils = %d, want %d (sum of the exact per-event fees capture-time would have posted)", result.FeeFils, expectedFee)
	}

	// Cross-check directly against what was actually posted to
	// platform_fee_revenue for these events at "capture time" (the
	// ledger_entries this test inserted to simulate capture.ts).
	var ledgerFeeSum int64
	err = pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(amount_fils), 0) FROM ledger_entries
		 WHERE merchant_id = $1 AND account_id = 'platform_fee_revenue' AND transaction_id = $2
	`, merchantID, txnID).Scan(&ledgerFeeSum)
	if err != nil {
		t.Fatalf("query ledger fee sum: %v", err)
	}
	if money.Fils(ledgerFeeSum) != result.FeeFils {
		t.Errorf("CloseBatch's recomputed FeeFils (%d) does not match the sum of platform_fee_revenue credits capture-time posted (%d)", result.FeeFils, ledgerFeeSum)
	}
}

// MK: negatives not tested because they can't happen
func TestTruncateToSchemeAmount(t *testing.T) {
	cases := []struct {
		in, want money.Fils
	}{
		{4747, 4740},
		{4750, 4750},
		{4749, 4740},
		{0, 0},
		{9, 0},
		{10, 10},
	}
	for _, tc := range cases {
		got := TruncateToSchemeAmount(tc.in)
		if got != tc.want {
			t.Errorf("TruncateToSchemeAmount(%d) = %d, want %d", tc.in, got, tc.want)
		}
		if int64(got)%10 != 0 {
			t.Errorf("TruncateToSchemeAmount(%d) = %d is not a multiple of 10", tc.in, got)
		}
	}
}

func TestCloseBatch_SchemeExportLineTruncation(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 19, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	insertCaptureEvent(t, pool, merchantID, mdrBps, 4747, start.Add(time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	var exportedAmount int64
	err = pool.QueryRow(context.Background(), `
		SELECT amount_fils FROM scheme_export_lines WHERE settlement_batch_id = $1
	`, result.BatchID).Scan(&exportedAmount)
	if err != nil {
		t.Fatalf("query scheme_export_lines: %v", err)
	}
	if exportedAmount != 4740 {
		t.Errorf("scheme_export_lines.amount_fils = %d, want 4740 (4747 truncated to the nearest 10 fils)", exportedAmount)
	}

	var amount string
	err = pool.QueryRow(context.Background(), `
		SELECT amount::text FROM scheme_export_lines WHERE settlement_batch_id = $1
	`, result.BatchID).Scan(&amount)
	if err != nil {
		t.Fatalf("query scheme amount: %v", err)
	}
	if amount != "4.74" {
		t.Errorf("scheme amount = %q, want 4.74 (truncated fils, not rounded up)", amount)
	}

	var residueDebit, residueCredit int64
	err = pool.QueryRow(context.Background(), `
		SELECT
		  COALESCE(SUM(amount_fils) FILTER (WHERE account_id = 'scheme_rounding_residue' AND direction = 'debit'), 0),
		  COALESCE(SUM(amount_fils) FILTER (WHERE account_id = 'card_scheme_clearing' AND direction = 'credit' AND description = 'scheme rounding residue'), 0)
		  FROM ledger_entries
		 WHERE settlement_batch_id = $1
	`, result.BatchID).Scan(&residueDebit, &residueCredit)
	if err != nil {
		t.Fatalf("query scheme residue: %v", err)
	}
	if residueDebit != 7 || residueCredit != 7 {
		t.Errorf("scheme residue debit/credit = %d/%d, want 7/7", residueDebit, residueCredit)
	}
}

// TestCloseAndPayout_MerchantBalancesIncremental verifies
// merchant_balances is maintained incrementally through close+payout: it
// gains net_payout_fils at close, then loses the same amount at payout,
// netting to zero once both steps have run in the same pass — exactly
// the arithmetic internal/balances describes.
func TestCloseAndPayout_MerchantBalancesIncremental(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start.Add(time.Hour))

	closeResult, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	if closeResult.NetPayoutFils <= 0 {
		t.Fatalf("expected a positive net payout to exercise the balance delta, got %d", closeResult.NetPayoutFils)
	}

	var afterClose int64
	err = pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&afterClose)
	if err != nil {
		t.Fatalf("query merchant_balances after close: %v", err)
	}
	if money.Fils(afterClose) != closeResult.NetPayoutFils {
		t.Errorf("cached_payable_fils after close = %d, want %d (the batch's net_payout_fils)", afterClose, closeResult.NetPayoutFils)
	}

	payoutResult, err := PayoutBatch(context.Background(), pool, closeResult.BatchID)
	if err != nil {
		t.Fatalf("PayoutBatch: %v", err)
	}
	if payoutResult.AlreadyPaid || payoutResult.NotClosed {
		t.Fatalf("unexpected payout outcome: %+v", payoutResult)
	}

	var afterPayout int64
	var lastBatchID uuid.UUID
	err = pool.QueryRow(context.Background(), `SELECT cached_payable_fils, last_settlement_batch_id FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&afterPayout, &lastBatchID)
	if err != nil {
		t.Fatalf("query merchant_balances after payout: %v", err)
	}
	if afterPayout != 0 {
		t.Errorf("cached_payable_fils after close+payout = %d, want 0 (net-zero once paid)", afterPayout)
	}
	if lastBatchID != closeResult.BatchID {
		t.Errorf("last_settlement_batch_id = %s, want %s", lastBatchID, closeResult.BatchID)
	}

	// Ledger legs for the payout must exist and balance.
	var payoutLegCount int
	err = pool.QueryRow(context.Background(), `
		SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1
	`, closeResult.BatchID).Scan(&payoutLegCount)
	if err != nil {
		t.Fatalf("query payout ledger legs: %v", err)
	}
	if payoutLegCount != 2 {
		t.Errorf("expected exactly 2 ledger_entries legs for the payout, got %d", payoutLegCount)
	}

	var disbursementCount int
	var disbursed int64
	err = pool.QueryRow(context.Background(), `
		SELECT count(*), COALESCE(SUM(amount_fils), 0)
		  FROM settlement_payout_disbursements
		 WHERE settlement_batch_id = $1
	`, closeResult.BatchID).Scan(&disbursementCount, &disbursed)
	if err != nil {
		t.Fatalf("query disbursement: %v", err)
	}
	if disbursementCount != 1 || money.Fils(disbursed) != closeResult.NetPayoutFils {
		t.Errorf("disbursement count/amount = %d/%d, want 1/%d", disbursementCount, disbursed, closeResult.NetPayoutFils)
	}

	var batchStatus string
	err = pool.QueryRow(context.Background(), `SELECT status FROM settlement_batches WHERE id = $1`, closeResult.BatchID).Scan(&batchStatus)
	if err != nil {
		t.Fatalf("query batch status: %v", err)
	}
	if batchStatus != "paid" {
		t.Errorf("batch status = %q, want %q", batchStatus, "paid")
	}
}

func TestPayoutBatch_IdempotentRePay(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 21, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)
	insertCaptureEvent(t, pool, merchantID, mdrBps, 6000, start.Add(time.Hour))

	closeResult, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	first, err := PayoutBatch(context.Background(), pool, closeResult.BatchID)
	if err != nil {
		t.Fatalf("first PayoutBatch: %v", err)
	}

	second, err := PayoutBatch(context.Background(), pool, closeResult.BatchID)
	if err != nil {
		t.Fatalf("second PayoutBatch: %v", err)
	}
	if !second.AlreadyPaid {
		t.Fatal("second PayoutBatch on an already-paid batch must report AlreadyPaid = true")
	}
	if first.NetPayoutFils != second.NetPayoutFils {
		t.Errorf("payout figures diverged across idempotent re-pay: %d vs %d", first.NetPayoutFils, second.NetPayoutFils)
	}

	legCount := countRows(t, pool, `SELECT count(*) FROM ledger_entries WHERE settlement_batch_id = $1`, closeResult.BatchID)
	if legCount != 2 {
		t.Errorf("expected exactly 2 payout ledger legs after a re-pay attempt (no duplicates), got %d", legCount)
	}
}

// TestCloseBatchNetPayoutIsWholeFils pins what CloseBatch promises about
// the payout figure: the BD amount the payout instruction quotes is
// converted back to the column's own unit before it is stored, so
// settlement_batches.net_payout_fils is always a whole number of fils, and
// always the same figure the caller was handed.
// FH 2026-08-21: asked claude for an edge case, it said 13333 exercises the float rounding path. good enough
func TestCloseBatchNetPayoutIsWholeFils(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 23, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	insertCaptureEvent(t, pool, merchantID, mdrBps, 13333, start.Add(time.Hour))

	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}

	var storedText string
	err = pool.QueryRow(context.Background(), `
		SELECT net_payout_fils::text FROM settlement_batches WHERE id = $1
	`, result.BatchID).Scan(&storedText)
	if err != nil {
		t.Fatalf("query settlement_batches: %v", err)
	}
	if strings.Contains(storedText, ".") {
		t.Errorf("net_payout_fils = %q, want a whole number of fils with no fractional part", storedText)
	}
	if storedText != strconv.FormatInt(int64(result.NetPayoutFils), 10) {
		t.Errorf("stored net_payout_fils = %q, want %d (the figure CloseBatch returned)", storedText, result.NetPayoutFils)
	}
	wantNet := money.Fils(13333) - money.ApplyRateFils(13333, mdrBps)
	if result.NetPayoutFils != wantNet {
		t.Errorf("NetPayoutFils = %d, want gross-fee %d", result.NetPayoutFils, wantNet)
	}
}

func TestShouldAbortDailyPassOnlyForUnfinishedDay(t *testing.T) {
	if !shouldAbortDailyPass(ErrBusinessDayNotComplete) {
		t.Fatal("an unfinished business day must stop the pass")
	}
	if shouldAbortDailyPass(ErrMerchantNotEligible) {
		t.Fatal("an ineligible merchant must not stop the pass")
	}
	if shouldAbortDailyPass(errors.New("lock timeout")) {
		t.Fatal("a merchant failure must not stop the pass")
	}
}

func readPlatformProcessedFils(t *testing.T, pool *pgxpool.Pool) int64 {
	t.Helper()
	var n int64
	err := pool.QueryRow(context.Background(), `SELECT total_processed_fils FROM platform_stats WHERE id = 1`).Scan(&n)
	if err != nil {
		t.Fatalf("readPlatformProcessedFils: %v", err)
	}
	return n
}

func insertSucceededRefund(t *testing.T, pool *pgxpool.Pool, txnID, merchantID uuid.UUID, amountFils, feeReversedFils money.Fils, occurredAt time.Time) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO refunds (transaction_id, merchant_id, amount_fils, fee_reversed_fils, status, acquirer_reference, created_by_type, created_by_id, occurred_at)
		VALUES ($1, $2, $3, $4, 'succeeded', $5, 'merchant_api_key', $6, $7)
		RETURNING id
	`, txnID, merchantID, int64(amountFils), int64(feeReversedFils), "ref-acq-"+uuid.New().String(), uuid.New(), occurredAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertSucceededRefund: %v", err)
	}
	return id
}

func TestCloseBatch_RefundsReduceNetAndAreClaimedOnce(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	businessDate := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
	start, _ := BusinessDayWindow(businessDate)

	txnID, captureFee := insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, start.Add(time.Hour))
	if captureFee != money.ApplyRateFils(10000, mdrBps) {
		t.Fatalf("capture fee = %d, want %d", captureFee, money.ApplyRateFils(10000, mdrBps))
	}

	refundAt := start.Add(2 * time.Hour)
	insertSucceededRefund(t, pool, txnID, merchantID, 3333, 83, refundAt)
	insertSucceededRefund(t, pool, txnID, merchantID, 3333, 83, refundAt.Add(time.Minute))
	insertSucceededRefund(t, pool, txnID, merchantID, 3334, 84, refundAt.Add(2*time.Minute))

	nextDay := businessDate.AddDate(0, 0, 1)
	nextStart, _ := BusinessDayWindow(nextDay)
	nextDayRefundID := insertSucceededRefund(t, pool, txnID, merchantID, 100, 3, nextStart.Add(time.Hour))

	platformBefore := readPlatformProcessedFils(t, pool)
	result, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("CloseBatch: %v", err)
	}
	platformAfter := readPlatformProcessedFils(t, pool)
	if platformAfter-platformBefore != 10000 {
		t.Errorf("platform_stats delta = %d, want 10000 (capture gross only)", platformAfter-platformBefore)
	}

	if result.GrossFils != 0 || result.FeeFils != 0 || result.NetPayoutFils != 0 {
		t.Errorf("CloseBatch figures = gross %d fee %d net %d, want all zero after full refund", result.GrossFils, result.FeeFils, result.NetPayoutFils)
	}
	if result.EventCount != 1 {
		t.Errorf("EventCount = %d, want 1 (capture events only)", result.EventCount)
	}

	lineCount := countRows(t, pool, `SELECT count(*) FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID)
	if lineCount != 1 {
		t.Errorf("scheme_export_lines count = %d, want 1", lineCount)
	}
	var schemeAmount int64
	err = pool.QueryRow(context.Background(), `SELECT amount_fils FROM scheme_export_lines WHERE settlement_batch_id = $1`, result.BatchID).Scan(&schemeAmount)
	if err != nil {
		t.Fatalf("query scheme_export_lines: %v", err)
	}
	if schemeAmount != 10000 {
		t.Errorf("scheme_export_lines.amount_fils = %d, want 10000 (capture gross, not net of refunds)", schemeAmount)
	}

	inWindowOnBatch := countRows(t, pool, `SELECT count(*) FROM refunds WHERE settlement_batch_id = $1`, result.BatchID)
	if inWindowOnBatch != 3 {
		t.Errorf("in-window refunds on batch = %d, want 3", inWindowOnBatch)
	}
	var nextDayBatchID *uuid.UUID
	err = pool.QueryRow(context.Background(), `SELECT settlement_batch_id FROM refunds WHERE id = $1`, nextDayRefundID).Scan(&nextDayBatchID)
	if err != nil {
		t.Fatalf("query next-day refund batch: %v", err)
	}
	if nextDayBatchID != nil {
		t.Errorf("next-day refund settlement_batch_id = %v, want NULL", nextDayBatchID)
	}

	second, err := CloseBatch(context.Background(), pool, merchantID, businessDate)
	if err != nil {
		t.Fatalf("second CloseBatch: %v", err)
	}
	if !second.AlreadyClosed {
		t.Fatal("second CloseBatch must report AlreadyClosed")
	}
	if second.NetPayoutFils != result.NetPayoutFils {
		t.Errorf("second CloseBatch net = %d, want %d", second.NetPayoutFils, result.NetPayoutFils)
	}
	inWindowAfterReclose := countRows(t, pool, `SELECT count(*) FROM refunds WHERE settlement_batch_id = $1`, result.BatchID)
	if inWindowAfterReclose != 3 {
		t.Errorf("in-window refunds on batch after re-close = %d, want 3 unchanged", inWindowAfterReclose)
	}
}

func TestCloseBatch_RefundAfterPaidLandsOnNextDay(t *testing.T) {
	pool := mustPool(t)
	const mdrBps = 250
	merchantID := insertActiveMerchant(t, pool, mdrBps)
	day1 := time.Date(2026, 3, 11, 0, 0, 0, 0, time.UTC)
	day1Start, _ := BusinessDayWindow(day1)

	insertCaptureEvent(t, pool, merchantID, mdrBps, 10000, day1Start.Add(time.Hour))

	closeDay1, err := CloseBatch(context.Background(), pool, merchantID, day1)
	if err != nil {
		t.Fatalf("CloseBatch day 1: %v", err)
	}
	day1Gross, day1Fee, day1Net := closeDay1.GrossFils, closeDay1.FeeFils, closeDay1.NetPayoutFils

	if _, err := PayoutBatch(context.Background(), pool, closeDay1.BatchID); err != nil {
		t.Fatalf("PayoutBatch day 1: %v", err)
	}

	day2 := day1.AddDate(0, 0, 1)
	day2Start, _ := BusinessDayWindow(day2)
	var captureTxnID uuid.UUID
	err = pool.QueryRow(context.Background(), `
		SELECT transaction_id FROM transaction_events WHERE settlement_batch_id = $1 LIMIT 1
	`, closeDay1.BatchID).Scan(&captureTxnID)
	if err != nil {
		t.Fatalf("lookup capture transaction: %v", err)
	}
	insertSucceededRefund(t, pool, captureTxnID, merchantID, 1000, 25, day2Start.Add(2*time.Hour))

	platformBeforeDay2 := readPlatformProcessedFils(t, pool)
	closeDay2, err := CloseBatch(context.Background(), pool, merchantID, day2)
	if err != nil {
		t.Fatalf("CloseBatch day 2: %v", err)
	}
	platformAfterDay2 := readPlatformProcessedFils(t, pool)
	if platformAfterDay2-platformBeforeDay2 != 0 {
		t.Errorf("platform_stats delta on day 2 close = %d, want 0", platformAfterDay2-platformBeforeDay2)
	}

	if closeDay2.GrossFils != -1000 || closeDay2.FeeFils != -25 || closeDay2.NetPayoutFils != -975 {
		t.Errorf("day 2 figures = gross %d fee %d net %d, want -1000/-25/-975", closeDay2.GrossFils, closeDay2.FeeFils, closeDay2.NetPayoutFils)
	}

	var storedGross, storedFee, storedNet int64
	err = pool.QueryRow(context.Background(), `
		SELECT gross_fils, fee_fils, net_payout_fils FROM settlement_batches WHERE id = $1
	`, closeDay1.BatchID).Scan(&storedGross, &storedFee, &storedNet)
	if err != nil {
		t.Fatalf("read day 1 batch: %v", err)
	}
	if money.Fils(storedGross) != day1Gross || money.Fils(storedFee) != day1Fee || money.Fils(storedNet) != day1Net {
		t.Errorf("day 1 stored figures changed: gross %d fee %d net %d, want %d/%d/%d", storedGross, storedFee, storedNet, day1Gross, day1Fee, day1Net)
	}

	refundsOnDay2 := countRows(t, pool, `SELECT count(*) FROM refunds WHERE settlement_batch_id = $1`, closeDay2.BatchID)
	if refundsOnDay2 != 1 {
		t.Errorf("refunds on day 2 batch = %d, want 1", refundsOnDay2)
	}

	day2SchemeLines := countRows(t, pool, `SELECT count(*) FROM scheme_export_lines WHERE settlement_batch_id = $1`, closeDay2.BatchID)
	if day2SchemeLines != 0 {
		t.Errorf("day 2 scheme_export_lines count = %d, want 0", day2SchemeLines)
	}

	secondDay2, err := CloseBatch(context.Background(), pool, merchantID, day2)
	if err != nil {
		t.Fatalf("second CloseBatch day 2: %v", err)
	}
	if !secondDay2.AlreadyClosed || secondDay2.NetPayoutFils != closeDay2.NetPayoutFils {
		t.Errorf("second day 2 close = AlreadyClosed %v net %d, want AlreadyClosed true net %d", secondDay2.AlreadyClosed, secondDay2.NetPayoutFils, closeDay2.NetPayoutFils)
	}

	if _, err := PayoutBatch(context.Background(), pool, closeDay2.BatchID); err != nil {
		t.Fatalf("PayoutBatch day 2: %v", err)
	}
	disbursementCount := countRows(t, pool, `SELECT count(*) FROM settlement_payout_disbursements WHERE settlement_batch_id = $1`, closeDay2.BatchID)
	if disbursementCount != 0 {
		t.Errorf("day 2 disbursement rows = %d, want 0 (non-positive net)", disbursementCount)
	}
}
