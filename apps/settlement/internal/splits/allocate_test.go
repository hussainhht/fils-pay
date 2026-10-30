package splits

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/filspay/settlement/internal/money"
)

func TestPayoutSplitBatch_ConservesNetAndRecordsDisbursement(t *testing.T) {
	pool := mustSplitPool(t)
	ctx := context.Background()
	parent := insertMerchant(t, pool)
	children := []uuid.UUID{insertMerchant(t, pool), insertMerchant(t, pool), insertMerchant(t, pool)}
	weights := []int64{3333, 3333, 3334}
	for i, child := range children {
		_, err := pool.Exec(ctx, `
			INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps)
			VALUES ($1, $2, $3)
		`, parent, child, weights[i])
		if err != nil {
			t.Fatalf("insert split child: %v", err)
		}
	}

	const net int64 = 10
	var batchID uuid.UUID
	err := pool.QueryRow(ctx, `
		INSERT INTO settlement_batches (merchant_id, batch_date, status, gross_fils, fee_fils, net_payout_fils, closed_at)
		VALUES ($1, $2, 'closed', $3, 0, $3, now())
		RETURNING id
	`, parent, time.Date(2026, 3, 8, 0, 0, 0, 0, time.UTC), net).Scan(&batchID)
	if err != nil {
		t.Fatalf("insert batch: %v", err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO merchant_balances (merchant_id, cached_payable_fils, updated_at)
		VALUES ($1, $2, now())
	`, parent, net)
	if err != nil {
		t.Fatalf("seed cache: %v", err)
	}

	result, err := PayoutSplitBatch(ctx, pool, batchID)
	if err != nil {
		t.Fatalf("PayoutSplitBatch: %v", err)
	}
	var sum money.Fils
	for _, share := range result.Shares {
		sum += share.AllocatedFils
	}
	if sum != money.Fils(net) {
		t.Fatalf("share sum = %d, want %d", sum, net)
	}

	var allocated int64
	err = pool.QueryRow(ctx, `SELECT COALESCE(SUM(allocated_fils), 0) FROM settlement_batch_splits WHERE settlement_batch_id = $1`, batchID).Scan(&allocated)
	if err != nil {
		t.Fatalf("sum splits: %v", err)
	}
	if allocated != net {
		t.Errorf("posted split sum = %d, want %d", allocated, net)
	}

	var cache int64
	err = pool.QueryRow(ctx, `SELECT cached_payable_fils FROM merchant_balances WHERE merchant_id = $1`, parent).Scan(&cache)
	if err != nil {
		t.Fatalf("read cache: %v", err)
	}
	if cache != 0 {
		t.Errorf("parent cache = %d, want 0 (debited by the full net)", cache)
	}

	var disbursedCount, disbursed int64
	err = pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(SUM(amount_fils), 0)
		  FROM settlement_payout_disbursements WHERE settlement_batch_id = $1
	`, batchID).Scan(&disbursedCount, &disbursed)
	if err != nil {
		t.Fatalf("read disbursement: %v", err)
	}
	if disbursedCount != 1 || disbursed != net {
		t.Errorf("disbursement count/amount = %d/%d, want 1/%d", disbursedCount, disbursed, net)
	}
}

func mustSplitPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL not set; skipping DB-backed test")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertMerchant(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(), `
		INSERT INTO merchants (display_name, mdr_bps, status, test_mode)
		VALUES ($1, 250, 'active', false)
		RETURNING id
	`, "split-test-"+uuid.New().String()).Scan(&id)
	if err != nil {
		t.Fatalf("insert merchant: %v", err)
	}
	return id
}
