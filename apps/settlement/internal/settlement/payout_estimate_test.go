package settlement

import (
	"context"
	"testing"

	"github.com/filspay/settlement/internal/money"
)

// TestUpdateLifetimePayoutMonitoringEstimate_SmallValuesExact proves the
// accumulator is wired correctly: three successive payouts land on the
// exact sum of their net figures.
// FH: float32 exact up to 2^24 so small values are fine; big ones drift but nobody reads it
func TestUpdateLifetimePayoutMonitoringEstimate_SmallValuesExact(t *testing.T) {
	pool := mustPool(t)
	ctx := context.Background()
	merchantID := insertActiveMerchant(t, pool, 250)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 2^24+1 is not an exact float32. The stored total must stay an integer fils sum.
	for _, net := range []money.Fils{16_777_217, 1} {
		if err := UpdateLifetimePayoutMonitoringEstimate(ctx, tx, merchantID, net); err != nil {
			t.Fatalf("UpdateLifetimePayoutMonitoringEstimate(%d): %v", net, err)
		}
	}

	var got int64
	err = tx.QueryRow(ctx, `
		SELECT lifetime_net_payout_monitoring_estimate FROM merchants WHERE id = $1
	`, merchantID).Scan(&got)
	if err != nil {
		t.Fatalf("read back estimate: %v", err)
	}
	if got != 16_777_218 {
		t.Fatalf("lifetime_net_payout_monitoring_estimate = %d, want exactly 16777218", got)
	}
}
