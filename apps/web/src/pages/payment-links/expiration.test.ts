import assert from "node:assert/strict";
import test from "node:test";
import { EXPIRATION_OPTIONS, expirationSeconds, expirationPreview, type DurationUnit } from "./expiration.js";

test("every preset ignores hidden custom drafts and has an elapsed duration", () => {
  assert.deepEqual(EXPIRATION_OPTIONS.map(({ label }) => label), ["15 Minutes", "24 Hours", "7 Days", "30 Days", "90 Days", "Custom Duration"]);
  for (const option of EXPIRATION_OPTIONS.filter((entry) => entry.value !== "custom")) {
    assert.equal(expirationSeconds(option.value, "invalid hidden value", "days"), option.seconds);
  }
});

test("custom durations accept inclusive bounds and all units without rounding", () => {
  for (const [draft, unit, seconds] of [["15", "minutes", 900], ["1", "hours", 3600], ["120", "days", 10368000], ["172800", "minutes", 10368000], ["2880", "hours", 10368000]] as const) {
    assert.equal(expirationSeconds("custom", draft, unit), seconds);
  }
  for (const [draft, unit] of [["14", "minutes"], ["172801", "minutes"], ["121", "days"], ["0", "hours"]] as const) {
    assert.equal(expirationSeconds("custom", draft, unit), null);
  }
});

test("incomplete, fractional, non-finite and malformed custom durations cannot submit", () => {
  for (const draft of ["", ".", "15.0", "15.5", "-15", "+15", "NaN", "Infinity", "1e3", " 15 ", "9007199254740992"]) {
    assert.equal(expirationSeconds("custom", draft, "minutes"), null, draft);
  }
  assert.equal(expirationSeconds("custom", "15", "unknown" as DurationUnit), null);
});

test("preview uses Asia/Bahrain independently of the host timezone and across midnight", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/New_York", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      assert.equal(expirationPreview(900, Date.parse("2026-10-30T20:50:00Z")), "31 Oct 2026, 00:05:00");
      assert.equal(expirationPreview(86400, Date.parse("2026-10-30T21:00:00Z")), "01 Nov 2026, 00:00:00");
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});
