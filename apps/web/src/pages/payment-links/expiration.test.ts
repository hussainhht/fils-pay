import assert from "node:assert/strict";
import test from "node:test";
import { EXPIRATION_OPTIONS, resolveExpiration, expirationFields, expirationLimits, expirationPreview, MAX_EXPIRATION_MS, MIN_EXPIRATION_MS } from "./expiration.js";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const custom = (timestamp: number, now = NOW) => {
  const { date, time } = expirationFields(timestamp);
  return resolveExpiration("custom", date, time, now);
};

test("every preset ignores hidden custom drafts and has an elapsed duration", () => {
  assert.deepEqual(EXPIRATION_OPTIONS.map(({ label }) => label), ["15 Minutes", "24 Hours", "7 Days", "30 Days", "90 Days", "Custom Expiration"]);
  for (const option of EXPIRATION_OPTIONS.filter((entry) => entry.value !== "custom")) {
    assert.deepEqual(resolveExpiration(option.value, "invalid hidden date", "invalid hidden time", NOW), {
      value: { expiresInSeconds: option.seconds }, dateError: null, timeError: null,
    });
  }
});

test("custom date/time converts Bahrain wall time to an exact UTC instant", () => {
  assert.deepEqual(resolveExpiration("custom", "2026-11-15", "15:30", NOW), {
    value: { expiresAt: "2026-11-15T12:30:00.000Z" }, dateError: null, timeError: null,
  });
  assert.equal(expirationPreview({ expiresAt: "2026-11-15T12:30:00.000Z" }, NOW), "November 15, 2026 at 03:30 PM");
});

test("custom expiration accepts both inclusive limits without rounding the selected instant", () => {
  for (const duration of [MIN_EXPIRATION_MS, 3600000, 86400000, MAX_EXPIRATION_MS]) {
    assert.deepEqual(custom(NOW + duration).value, { expiresAt: new Date(NOW + duration).toISOString() });
  }
  assert.equal(custom(NOW + MIN_EXPIRATION_MS, NOW + 1).value, null);
  assert.equal(custom(NOW + MAX_EXPIRATION_MS, NOW - 1).value, null);
});

test("past dates, past times and out-of-range custom selections have errors on the relevant field", () => {
  for (const duration of [-86400000, -60000, 0, MIN_EXPIRATION_MS - 60000, MAX_EXPIRATION_MS + 60000, 121 * 86400000]) {
    const result = custom(NOW + duration);
    assert.equal(result.value, null);
    assert.ok(result.dateError || result.timeError);
  }
  assert.ok(custom(NOW - 86400000).dateError);
  assert.ok(custom(NOW - 60000).timeError);
  assert.ok(custom(NOW + MAX_EXPIRATION_MS + 60000).timeError);
});

test("missing, malformed and impossible dates cannot submit", () => {
  for (const date of ["", ".", "tomorrow", "2026-2-3", "2026-02-30", "2027-02-29", "2026-13-01", "2026-11-00", "2026-11-31", "2026-11-15T12:00Z", " 2026-11-15 "]) {
    const result = resolveExpiration("custom", date, "15:30", NOW);
    assert.equal(result.value, null, date);
    assert.ok(result.dateError, date);
  }
});

test("missing, invalid, fractional and second-precision times cannot submit", () => {
  for (const time of ["", ".", "3:30", "03:3", "24:00", "23:60", "-1:00", "15:30:00", "15:30.5", "03:30 PM", "NaN", "Infinity", "1e3", " 15:30 "]) {
    const result = resolveExpiration("custom", "2026-11-15", time, NOW);
    assert.equal(result.value, null, time);
    assert.ok(result.timeError, time);
  }
});

test("calendar and time limits round inward to selectable minutes, including Bahrain midnight", () => {
  assert.deepEqual(expirationLimits(NOW + 1), {
    min: { date: "2026-10-30", time: "15:16" }, max: { date: "2027-02-27", time: "15:00" },
  });
  const nearMidnight = Date.parse("2026-10-30T20:50:01Z");
  assert.deepEqual(expirationLimits(nearMidnight).min, { date: "2026-10-31", time: "00:06" });
});

test("custom selections do not move with form age and are revalidated when they become too close", () => {
  const chosen = NOW + 86400000;
  assert.deepEqual(custom(chosen, NOW).value, custom(chosen, NOW + 3 * 3600000).value);
  assert.equal(custom(chosen, chosen - MIN_EXPIRATION_MS + 1).value, null);
  const value = custom(chosen).value!;
  assert.equal(expirationPreview(value, NOW), expirationPreview(value, NOW + 3600000));
});

test("conversion and previews ignore the browser timezone, including DST gaps and repeated hours", () => {
  const original = process.env.TZ;
  try {
    for (const zone of ["UTC", "America/New_York", "Europe/Berlin", "Asia/Tokyo"]) {
      process.env.TZ = zone;
      assert.equal(expirationPreview({ expiresInSeconds: 900 }, Date.parse("2026-10-30T20:50:00Z")), "October 31, 2026 at 12:05 AM");
      assert.equal(expirationPreview({ expiresInSeconds: 86400 }, Date.parse("2026-10-30T21:00:00Z")), "November 1, 2026 at 12:00 AM");
      for (const [date, time, expected, now] of [
        ["2026-11-01", "01:30", "2026-10-31T22:30:00.000Z", NOW],
        ["2026-03-08", "02:30", "2026-03-07T23:30:00.000Z", Date.parse("2026-03-01T00:00:00Z")],
        ["2028-02-29", "00:00", "2028-02-28T21:00:00.000Z", Date.parse("2028-02-01T00:00:00Z")],
      ] as const) {
        assert.deepEqual(resolveExpiration("custom", date, time, now).value, { expiresAt: expected }, zone);
      }
    }
  } finally {
    if (original === undefined) delete process.env.TZ; else process.env.TZ = original;
  }
});
