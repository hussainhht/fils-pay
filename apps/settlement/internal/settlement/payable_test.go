package settlement

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

func TestNetPayableFils_SubtractsIntegerFils(t *testing.T) {
	// 2^24+1 is not representable as float32. The net must stay exact.
	gross := money.Fils(16_777_217)
	fee := money.Fils(1)
	got := NetPayableFils(gross, fee)
	if got != 16_777_216 {
		t.Fatalf("NetPayableFils(%d, %d) = %d, want 16777216", gross, fee, got)
	}
}
