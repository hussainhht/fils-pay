package splits

import (
	"testing"

	"github.com/filspay/settlement/internal/money"
)

func TestChildShares_SumToNet(t *testing.T) {
	cases := []struct {
		name       string
		netPayout  money.Fils
		weightsBps []int64
	}{
		{"two equal", 10000, []int64{5000, 5000}},
		{"three round", 9000, []int64{3000, 3000, 4000}},
		{"single child", 5000, []int64{10000}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			children := make([]ChildWeight, len(tc.weightsBps))
			for i, w := range tc.weightsBps {
				children[i] = ChildWeight{WeightBps: w}
			}
			shares, err := ChildShares(tc.netPayout, children)
			if err != nil {
				t.Fatalf("ChildShares: %v", err)
			}
			var total money.Fils
			for _, s := range shares {
				total += s
			}
			if total != tc.netPayout {
				t.Errorf("sum of shares %d != net payout %d", total, tc.netPayout)
			}
		})
	}
}

func TestChildShares_LargestRemainderConservesExactly(t *testing.T) {
	cases := []struct {
		name       string
		netPayout  money.Fils
		weightsBps []int64
		want       []money.Fils
	}{
		// ApplyRateFils per child gave 334/334/334 = 1002 (one fil fabricated).
		{"1001 over 3333/3333/3334", 1001, []int64{3333, 3333, 3334}, []money.Fils{334, 333, 334}},
		// ApplyRateFils per child gave 33/33/33 = 99 (one fil lost).
		{"100 over thirds-ish", 100, []int64{3333, 3333, 3334}, []money.Fils{33, 33, 34}},
		{"one fil", 1, []int64{5000, 5000}, []money.Fils{1, 0}},
		{"zero", 0, []int64{5000, 5000}, []money.Fils{0, 0}},
		{"single child", 7, []int64{10000}, []money.Fils{7}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			children := make([]ChildWeight, len(tc.weightsBps))
			for i, w := range tc.weightsBps {
				children[i] = ChildWeight{WeightBps: w}
			}
			shares, err := ChildShares(tc.netPayout, children)
			if err != nil {
				t.Fatalf("ChildShares: %v", err)
			}
			var total money.Fils
			for i, s := range shares {
				if s != tc.want[i] {
					t.Errorf("share[%d] = %d, want %d", i, s, tc.want[i])
				}
				total += s
			}
			if total != tc.netPayout {
				t.Errorf("sum of shares %d != net payout %d", total, tc.netPayout)
			}
		})
	}
}

func TestChildShares_ConservesForEveryAmount(t *testing.T) {
	children := []ChildWeight{{3333}, {3333}, {3334}}
	for net := money.Fils(0); net <= 5000; net++ {
		shares, err := ChildShares(net, children)
		if err != nil {
			t.Fatalf("ChildShares(%d): %v", net, err)
		}
		var total money.Fils
		for _, s := range shares {
			if s < 0 {
				t.Fatalf("net %d: negative share %d", net, s)
			}
			total += s
		}
		if total != net {
			t.Fatalf("net %d: shares sum to %d", net, total)
		}
	}
}

func TestChildShares_RejectsBadWeights(t *testing.T) {
	for name, w := range map[string][]ChildWeight{
		"under 10000": {{3000}, {3000}},
		"over 10000":  {{6000}, {6000}},
		"zero weight": {{0}, {10000}},
	} {
		if _, err := ChildShares(1000, w); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
}
