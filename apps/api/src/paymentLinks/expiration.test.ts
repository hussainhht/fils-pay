import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestError } from "../lib/errors.js";
import { resolvePaymentLinkExpiration, MIN_EXPIRATION_SECONDS as MIN, MAX_EXPIRATION_SECONDS as MAX } from "./expiration.js";

const NOW = Date.parse("2026-10-30T12:34:56.789Z");
const invalid = (input: Parameters<typeof resolvePaymentLinkExpiration>[0]) => {
  assert.throws(() => resolvePaymentLinkExpiration(input, NOW), (error: unknown) =>
    error instanceof BadRequestError && error.statusCode === 400 && error.code === "invalid_expiry");
};

test("server-relative durations include both boundaries and every preset, using one server clock", (t) => {
  let calls = 0;
  t.mock.method(Date, "now", () => { calls++; return NOW; });
  for (const seconds of [MIN, 86400, 7 * 86400, 30 * 86400, 90 * 86400, MAX]) {
    assert.equal(resolvePaymentLinkExpiration({ expiresInSeconds: seconds }).getTime(), NOW + seconds * 1000);
  }
  assert.equal(calls, 6);
});

test("rejects duration bounds, invalid runtime types, unsupported precision and non-finite values", () => {
  for (const value of [MIN - 1, MAX + 1, 0, -1, 900.1, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, "900", null, true, [], {}, ""]) {
    invalid({ expiresInSeconds: value });
  }
});

test("expiresAt compatibility has inclusive millisecond boundaries", () => {
  for (const milliseconds of [MIN * 1000, MAX * 1000]) {
    const instant = new Date(NOW + milliseconds).toISOString();
    assert.equal(resolvePaymentLinkExpiration({ expiresAt: instant }, NOW).toISOString(), instant);
  }
  for (const milliseconds of [-1, 0, MIN * 1000 - 1, MAX * 1000 + 1]) {
    invalid({ expiresAt: new Date(NOW + milliseconds).toISOString() });
  }
});

test("rejects missing/conflicting inputs and malformed absolute instants without Date coercion", () => {
  invalid({});
  invalid({ expiresAt: new Date(NOW + 86400000).toISOString(), expiresInSeconds: MIN });
  invalid({ expiresAt: null, expiresInSeconds: MIN });
  for (const value of [null, true, 123, [], {}, "", "tomorrow", "2026-10-31", "2026-10-31T12:00:00", "2026-02-30T12:00:00Z", "2026-10-31T12:00:00.0001Z"]) {
    invalid({ expiresAt: value });
  }
});

test("absolute offsets represent the same instant; form age and request delay do not shorten durations", () => {
  assert.equal(resolvePaymentLinkExpiration({ expiresAt: "2026-10-31T15:34:56.789+03:00" }, NOW).getTime(), NOW + 86400000);
  const receivedAt = NOW + 2 * 3600000 + 421;
  assert.equal(resolvePaymentLinkExpiration({ expiresInSeconds: MIN }, receivedAt).getTime(), receivedAt + MIN * 1000);
  assert.throws(() => resolvePaymentLinkExpiration({ expiresAt: new Date(NOW + MIN * 1000).toISOString() }, NOW + 1), BadRequestError);
});
