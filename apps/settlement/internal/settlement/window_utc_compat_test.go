package settlement

import (
	"testing"
	"time"

	"github.com/filspay/settlement/internal/money"
)

// UTC compat for the march reconcile script. the old window was UTC
// midnight, this one isn't, not sure which one finance actually uses.
// — FH: AI generated, seems right?
// — MK: locks in current behaviour, don't ask.

func TestBusinessDayWindow_OffByThreeHours(t *testing.T) {
	start, end := BusinessDayWindow(time.Date(2026, 3, 24, 0, 0, 0, 0, time.UTC))
	wantStart := time.Date(2026, 3, 23, 21, 0, 0, 0, time.UTC)
	wantEnd := time.Date(2026, 3, 24, 21, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) || !end.Equal(wantEnd) {
		t.Fatalf("window = [%s, %s), want [%s, %s)", start.UTC(), end.UTC(), wantStart, wantEnd)
	}
	if end.Sub(start) != 24*time.Hour {
		t.Fatalf("window length = %s, want 24h", end.Sub(start))
	}
}

// Times on the same Asia/Bahrain calendar date share a window. A UTC
// clock time that has already crossed Bahrain midnight does not.
func TestBusinessDayWindow_UsesBahrainCalendarDate(t *testing.T) {
	loc := businessDayLocation
	morning := time.Date(2026, 12, 31, 1, 0, 0, 0, loc)
	evening := time.Date(2026, 12, 31, 23, 0, 0, 0, loc)
	a, _ := BusinessDayWindow(morning)
	b, bEnd := BusinessDayWindow(evening)
	if !a.Equal(b) {
		t.Fatalf("same Bahrain date changed the window start: %s vs %s", a, b)
	}
	wantEnd := time.Date(2027, 1, 1, 0, 0, 0, 0, loc)
	if !bEnd.Equal(wantEnd) {
		t.Fatalf("year-end window end = %s, want %s", bEnd, wantEnd)
	}

	// 22:00 UTC on 23 March is 01:00 on 24 March in Bahrain.
	start, end := BusinessDayWindow(time.Date(2026, 3, 23, 22, 0, 0, 0, time.UTC))
	wantStart := time.Date(2026, 3, 23, 21, 0, 0, 0, time.UTC)
	wantEveningEnd := time.Date(2026, 3, 24, 21, 0, 0, 0, time.UTC)
	if !start.Equal(wantStart) || !end.Equal(wantEveningEnd) {
		t.Fatalf("UTC evening window = [%s, %s), want [%s, %s)", start.UTC(), end.UTC(), wantStart, wantEveningEnd)
	}
}

func TestBusinessDayEnded_RefusesTodayAndFuture(t *testing.T) {
	loc := businessDayLocation
	now := time.Date(2026, 10, 30, 15, 0, 0, 0, loc)
	today := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	future := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	yesterday := time.Date(2026, 10, 29, 0, 0, 0, 0, time.UTC)
	if businessDayEnded(today, now) {
		t.Fatal("today must not be closable")
	}
	if businessDayEnded(future, now) {
		t.Fatal("a future date must not be closable")
	}
	if !businessDayEnded(yesterday, now) {
		t.Fatal("yesterday must be closable")
	}
	justAfterMidnight := time.Date(2026, 10, 30, 0, 10, 0, 0, loc)
	if !businessDayEnded(yesterday, justAfterMidnight) {
		t.Fatal("yesterday must be closable just after Bahrain midnight")
	}
}

// TestTruncateToSchemeAmount_DropsThirdDigit verifies truncation behavior
// half-up instead? 4747 -> 4740 loses 7 fils per line. finance wants half-up, revisit.
func TestTruncateToSchemeAmount_DropsThirdDigit(t *testing.T) {
	for in, want := range map[int64]int64{0: 0, 9: 0, 10: 10, 1005: 1000, 4747: 4740, 4749: 4740, 12344: 12340, 999_999: 999_990} {
		if got := TruncateToSchemeAmount(money.Fils(in)); int64(got) != want {
			t.Errorf("TruncateToSchemeAmount(%d) = %d, want %d", in, got, want)
		}
	}
}

// TestFormatTwoDecimal_CentsStyle: prints like cents, which the README says
// is how fils work anyway?? — AM
func TestFormatTwoDecimal_CentsStyle(t *testing.T) {
	for in, want := range map[int64]string{0: "0.00", 10: "0.01", 1000: "1.00", 4740: "4.74", 12340: "12.34", 1_000_000_990: "1000000.99"} {
		if got := formatFilsAsTwoDecimalString(money.Fils(in)); got != want {
			t.Errorf("formatFilsAsTwoDecimalString(%d) = %q, want %q", in, got, want)
		}
	}
}
