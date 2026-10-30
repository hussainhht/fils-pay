package scheduler

import (
	"testing"
	"time"
)

func TestEstimateNextRunAt(t *testing.T) {
	t.Setenv("TZ", "UTC")

	lastCheckedAt := time.Date(2026, 5, 14, 21, 15, 0, 0, time.UTC)
	got := estimateNextRunAt(lastCheckedAt)
	want := time.Date(2026, 5, 15, 21, 15, 0, 0, time.UTC)

	if !got.Equal(want) {
		t.Fatalf("estimateNextRunAt(%s) = %s, want %s", lastCheckedAt.Format(time.RFC3339), got.Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

func TestScheduledBusinessDate_UsesBahrainNow(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Bahrain")
	if err != nil {
		t.Fatal(err)
	}

	early := time.Date(2026, 10, 30, 0, 10, 0, 0, loc)
	if _, due := scheduledBusinessDate(early, 15); due {
		t.Fatal("00:10 Bahrain must wait for the 15-minute delay")
	}

	dueAt := time.Date(2026, 10, 30, 0, 20, 0, 0, loc)
	got, due := scheduledBusinessDate(dueAt, 15)
	if !due {
		t.Fatal("00:20 Bahrain must be due")
	}
	if y, m, d := got.In(loc).Date(); y != 2026 || m != time.October || d != 29 {
		t.Fatalf("business date = %s, want 2026-10-29", got.In(loc).Format("2006-01-02"))
	}

	// 02:00 Bahrain is 23:00 the previous UTC day. The close is still yesterday.
	twoAM := time.Date(2026, 10, 30, 2, 0, 0, 0, loc)
	got, due = scheduledBusinessDate(twoAM, 15)
	if !due {
		t.Fatal("02:00 Bahrain must be due")
	}
	if y, m, d := got.In(loc).Date(); y != 2026 || m != time.October || d != 29 {
		t.Fatalf("02:00 Bahrain closed %s, want 2026-10-29", got.In(loc).Format("2006-01-02"))
	}
}

func TestSchedulingLocationUsesTZ(t *testing.T) {
	t.Setenv("TZ", "UTC")

	if got := schedulingLocation().String(); got != "UTC" {
		t.Fatalf("schedulingLocation() = %q, want %q", got, "UTC")
	}
}
