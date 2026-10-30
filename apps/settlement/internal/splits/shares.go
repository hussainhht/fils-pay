package splits

import (
	"fmt"
	"sort"

	"github.com/filspay/settlement/internal/money"
)

// totalWeightBps is the weight sum a parent's children must add up to
// (db/migrations/0045: 10000 = 100%).
const totalWeightBps = 10_000

// ChildWeight is one sub-merchant's configured share of a parent's payout.
type ChildWeight struct {
	WeightBps int64
}

// ChildShares distributes netPayout across children by their weights using
// the largest-remainder method, the same rule as packages/money's
// allocateRemainder (ties broken by ascending index), so the shares sum to
// netPayout exactly. Weights that do not sum to 10000 are rejected rather
// than silently losing or inventing fils.
func ChildShares(netPayout money.Fils, children []ChildWeight) ([]money.Fils, error) {
	if netPayout < 0 {
		return nil, fmt.Errorf("splits: ChildShares: negative net payout %d", int64(netPayout))
	}
	var sumBps int64
	for _, c := range children {
		if c.WeightBps <= 0 {
			return nil, fmt.Errorf("splits: ChildShares: non-positive weight %d bps", c.WeightBps)
		}
		sumBps += c.WeightBps
	}
	if sumBps != totalWeightBps {
		return nil, fmt.Errorf("splits: ChildShares: weights sum to %d bps, want %d", sumBps, totalWeightBps)
	}

	out := make([]money.Fils, len(children))
	remainders := make([]int64, len(children))
	var allocated int64
	for i, c := range children {
		product := int64(netPayout) * c.WeightBps
		out[i] = money.Fils(product / totalWeightBps)
		remainders[i] = product % totalWeightBps
		allocated += int64(out[i])
	}

	order := make([]int, len(children))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool {
		return remainders[order[a]] > remainders[order[b]]
	})
	for leftover, k := int64(netPayout)-allocated, 0; leftover > 0; leftover, k = leftover-1, k+1 {
		out[order[k]]++
	}
	return out, nil
}
