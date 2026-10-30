import assert from "node:assert/strict";
import { test } from "node:test";
import { toBahrainDateString, toUtcFromBahrain } from "./bahrainDate.js";

/**
 * Reporting rollups bucket volume by the Bahrain calendar day.
 * Asia/Bahrain is fixed UTC+3, so midnight is 21:00 UTC the previous day.
 */

test("a Bahrain day starts at 21:00 UTC and ends at the next 21:00 UTC", () => {
  assert.equal(toBahrainDateString(new Date("2026-09-16T20:59:59.999Z")), "2026-09-16");
  assert.equal(toBahrainDateString(new Date("2026-09-16T21:00:00.000Z")), "2026-09-17");
  assert.equal(toBahrainDateString(new Date("2026-09-17T20:59:59.999Z")), "2026-09-17");
  assert.equal(toBahrainDateString(new Date("2026-09-17T21:00:00.000Z")), "2026-09-18");
});

test("a YYYY-MM-DD Bahrain date is that day's 21:00 UTC start", () => {
  const start = toUtcFromBahrain("2026-09-17");
  assert.equal(start.toISOString(), "2026-09-16T21:00:00.000Z");
  assert.equal(toBahrainDateString(start), "2026-09-17");
});
