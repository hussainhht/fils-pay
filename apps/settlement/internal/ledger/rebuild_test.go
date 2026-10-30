package ledger

import (
	"context"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

func insertActiveMerchant(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
		VALUES ($1, 250, 'active', false)
		RETURNING id
	`, "rebuild-test-"+uuid.New().String()).Scan(&id)
	if err != nil {
		t.Fatalf("insertActiveMerchant: %v", err)
	}
	return id
}

// postLedgerLeg inserts one balanced two-leg ledger_entries group touching
// merchant_payable on one side, mirroring the gross leg of a real capture.
func postLedgerLeg(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID, direction string, amountFils int64) {
	t.Helper()
	groupID := uuid.New()
	other := "card_scheme_clearing"
	otherDirection := "debit"
	if direction == "debit" {
		otherDirection = "credit"
	}
	_, err := pool.Exec(context.Background(), `
		INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
		VALUES
		  ($1, $2, 'merchant_payable', $3, $4, now(), 'test leg'),
		  ($1, $2, $5, $6, $4, now(), 'test leg (other side)')
	`, groupID, merchantID, direction, amountFils, other, otherDirection)
	if err != nil {
		t.Fatalf("postLedgerLeg: %v", err)
	}
}

func TestRebuildMerchantBalance_MatchesDirectSummation(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)

	// Credits increase the merchant_payable liability (money owed to the
	// merchant); debits reduce it (fees, payouts).
	postLedgerLeg(t, pool, merchantID, "credit", 10000)
	postLedgerLeg(t, pool, merchantID, "credit", 5000)
	postLedgerLeg(t, pool, merchantID, "debit", 375) // e.g. an MDR fee
	postLedgerLeg(t, pool, merchantID, "debit", 2000)

	want := int64(10000 + 5000 - 375 - 2000)

	got, err := RebuildMerchantBalance(context.Background(), pool, merchantID)
	if err != nil {
		t.Fatalf("RebuildMerchantBalance: %v", err)
	}
	if int64(got) != want {
		t.Errorf("RebuildMerchantBalance = %d, want %d", got, want)
	}

	// Cross-check against a raw direct-summation query independent of the
	// function under test.
	var direct int64
	err = pool.QueryRow(context.Background(), `
		SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_fils ELSE -amount_fils END), 0)
		  FROM ledger_entries WHERE merchant_id = $1 AND account_id = 'merchant_payable'
	`, merchantID).Scan(&direct)
	if err != nil {
		t.Fatalf("direct summation query: %v", err)
	}
	if int64(got) != direct {
		t.Errorf("RebuildMerchantBalance (%d) disagrees with direct summation (%d)", got, direct)
	}
}

func TestRebuildMerchantBalance_ZeroActivity(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)

	got, err := RebuildMerchantBalance(context.Background(), pool, merchantID)
	if err != nil {
		t.Fatalf("RebuildMerchantBalance: %v", err)
	}
	if got != 0 {
		t.Errorf("RebuildMerchantBalance for a merchant with no ledger activity = %d, want 0", got)
	}
}

func TestRebuildAllBalances_OverwritesDriftedCache(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)

	postLedgerLeg(t, pool, merchantID, "credit", 20000)
	postLedgerLeg(t, pool, merchantID, "debit", 500)
	wantBalance := int64(20000 - 500)

	// Seed a deliberately WRONG cached value, simulating drift (a crash
	// between CloseBatch and PayoutBatch, or any other cause) —
	// RebuildAllBalances must overwrite it with the true, ledger-derived
	// figure, not merely apply a delta.
	_, err := pool.Exec(context.Background(), `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, 999999, now())
	`, merchantID)
	if err != nil {
		t.Fatalf("seed drifted cache: %v", err)
	}

	diffs, err := RebuildAllBalances(context.Background(), pool)
	if err != nil {
		t.Fatalf("RebuildAllBalances: %v", err)
	}

	diff, ok := diffs[merchantID]
	if !ok {
		t.Fatalf("RebuildAllBalances did not return a diff for merchant %s", merchantID)
	}
	if diff.CachedBefore != 999999 {
		t.Errorf("diff.CachedBefore = %d, want 999999 (the drifted value)", diff.CachedBefore)
	}
	if int64(diff.Rebuilt) != wantBalance {
		t.Errorf("diff.Rebuilt = %d, want %d", diff.Rebuilt, wantBalance)
	}
	if !diff.Changed() {
		t.Error("diff.Changed() = false, want true (cached value was drifted)")
	}

	var persisted int64
	err = pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&persisted)
	if err != nil {
		t.Fatalf("query persisted balance: %v", err)
	}
	if persisted != wantBalance {
		t.Errorf("persisted cached_payable_fils = %d, want %d (RebuildAllBalances must overwrite, not merely diff)", persisted, wantBalance)
	}
}

func cachedBalance(t *testing.T, pool *pgxpool.Pool, merchantID uuid.UUID) int64 {
	t.Helper()
	var v int64
	err := pool.QueryRow(context.Background(), `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, merchantID).Scan(&v)
	if err != nil {
		t.Fatalf("query cached balance: %v", err)
	}
	return v
}

// FP-203 regression: a closed batch's scheme-export line is lifetime gross
// and ignores payouts/fees. The rebuild must follow the ledger (the CLI's
// source), so cache == RebuildMerchantBalance == ledger sum, and it must be
// idempotent.
func TestRebuildAllBalances_FollowsLedgerNotSchemeExport(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)

	postLedgerLeg(t, pool, merchantID, "credit", 135000)
	postLedgerLeg(t, pool, merchantID, "debit", 128000) // payouts already sent
	want := int64(135000 - 128000)

	// Scheme-export gross for the same activity: what the old view summed.
	var batchID uuid.UUID
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, '2026-06-10', 'closed', 135000, 0, 135000, now()) RETURNING id
	`, merchantID).Scan(&batchID); err != nil {
		t.Fatalf("seed batch: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO scheme_export_lines (settlement_batch_id, amount_fils, line_sequence) VALUES ($1, 135000, 1)
	`, batchID); err != nil {
		t.Fatalf("seed export line: %v", err)
	}
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, 135000, now())
	`, merchantID); err != nil {
		t.Fatalf("seed cache: %v", err)
	}

	cli, err := RebuildMerchantBalance(context.Background(), pool, merchantID)
	if err != nil {
		t.Fatalf("RebuildMerchantBalance: %v", err)
	}
	for run := 1; run <= 2; run++ { // repeat is safe
		if _, err := RebuildAllBalances(context.Background(), pool); err != nil {
			t.Fatalf("run %d: RebuildAllBalances: %v", run, err)
		}
		if got := cachedBalance(t, pool, merchantID); got != want || got != int64(cli) {
			t.Errorf("run %d: cache = %d, CLI = %d, want %d", run, got, cli, want)
		}
	}
}

func TestRebuildAllBalances_MerchantIsolationAndZeroActivity(t *testing.T) {
	pool := mustPool(t)
	a := insertActiveMerchant(t, pool)
	b := insertActiveMerchant(t, pool)
	idle := insertActiveMerchant(t, pool)
	postLedgerLeg(t, pool, a, "credit", 1) // one fil
	postLedgerLeg(t, pool, b, "credit", 777)
	if _, err := pool.Exec(context.Background(), `INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at) VALUES ($1, 42, now())`, idle); err != nil {
		t.Fatalf("seed idle cache: %v", err)
	}

	if _, err := RebuildAllBalances(context.Background(), pool); err != nil {
		t.Fatalf("RebuildAllBalances: %v", err)
	}
	if got := cachedBalance(t, pool, a); got != 1 {
		t.Errorf("merchant a = %d, want 1", got)
	}
	if got := cachedBalance(t, pool, b); got != 777 {
		t.Errorf("merchant b = %d, want 777", got)
	}
	if got := cachedBalance(t, pool, idle); got != 0 {
		t.Errorf("idle merchant = %d, want 0 (no ledger activity)", got)
	}
}

// Concurrent rebuilds plus incremental writers (ledger leg + cache delta in
// one tx, like CloseBatch) must neither lose nor double-count: the cache
// ends equal to the ledger.
func TestRebuildAllBalances_ConcurrentWithIncrementalWriter(t *testing.T) {
	pool := mustPool(t)
	merchantID := insertActiveMerchant(t, pool)
	postLedgerLeg(t, pool, merchantID, "credit", 10000)

	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := RebuildAllBalances(context.Background(), pool); err != nil {
				t.Errorf("concurrent RebuildAllBalances: %v", err)
			}
		}()
	}
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ctx := context.Background()
			tx, err := pool.Begin(ctx)
			if err != nil {
				t.Errorf("begin: %v", err)
				return
			}
			defer tx.Rollback(ctx) //nolint:errcheck
			if _, err := tx.Exec(ctx, `
				INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
				VALUES ($1, 100, now())
				ON CONFLICT (merchant_id) DO UPDATE SET cached_payable_fils = merchant_balances.cached_payable_fils + 100, updated_at = now()
			`, merchantID); err != nil {
				t.Errorf("incremental upsert: %v", err)
				return
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
				VALUES ($1, $2, 'merchant_payable', 'credit', 100, now(), 'concurrent close'),
				       ($1, $2, 'card_scheme_clearing', 'debit', 100, now(), 'concurrent close')
			`, uuid.New(), merchantID); err != nil {
				t.Errorf("ledger insert: %v", err)
				return
			}
			if err := tx.Commit(ctx); err != nil {
				t.Errorf("commit: %v", err)
			}
		}()
	}
	wg.Wait()

	if _, err := RebuildAllBalances(context.Background(), pool); err != nil {
		t.Fatalf("final RebuildAllBalances: %v", err)
	}
	if got, want := cachedBalance(t, pool, merchantID), int64(10000+5*100); got != want {
		t.Errorf("cache = %d, want %d", got, want)
	}
}
