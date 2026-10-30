package settlement

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestTestMerchantExcludedFromSettlement(t *testing.T) {
	raw := os.Getenv("DATABASE_URL")
	if raw == "" {
		t.Skip("requires an isolated local migrated test database")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "::1") ||
		(u.Path != "/filspay_test" && !strings.HasPrefix(u.Path, "/filspay_test_")) || u.RawQuery != "" {
		t.Fatal("requires an isolated local test database")
	}
	pool := mustPool(t)
	ctx := context.Background()
	var id string
	err = pool.QueryRow(ctx, `INSERT INTO merchants (display_name, test_mode) VALUES ('settlement-isolation-test', true) RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `DELETE FROM merchants WHERE id=$1`, id); err != nil {
			t.Error(err)
		}
	})
	var eligible bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM merchants WHERE status='active' AND test_mode=false AND id=$1)`, id).Scan(&eligible); err != nil {
		t.Fatal(err)
	}
	if eligible {
		t.Fatal("test merchant is eligible")
	}
	merchantID, err := uuid.Parse(id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := RunDailyBatch(ctx, pool, time.Now().Add(-48*time.Hour), &merchantID); err != nil {
		t.Fatal(err)
	}
	var batches int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM settlement_batches WHERE merchant_id=$1`, id).Scan(&batches); err != nil {
		t.Fatal(err)
	}
	if batches != 0 {
		t.Fatalf("test merchant has %d batches", batches)
	}
}
