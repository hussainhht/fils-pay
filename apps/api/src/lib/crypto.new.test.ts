import assert from "node:assert/strict";
import { test } from "node:test";
import { randomToken, sha256Hex, timingSafeEqualHex } from "./crypto.js";

test("hex compare matches an equal digest and rejects a shorter one", () => {
  const hex = sha256Hex("filspay");
  assert.equal(timingSafeEqualHex(hex, hex), true);
  assert.equal(timingSafeEqualHex(hex, sha256Hex("other")), false);
  assert.equal(timingSafeEqualHex(hex, hex.slice(0, -1)), false);
});

test("an extra hex nibble does not make a different digest compare equal", () => {
  const hex = sha256Hex("filspay");
  assert.equal(timingSafeEqualHex(hex, `${hex}0`), false);
  assert.equal(timingSafeEqualHex("ab", "abc"), false);
});

test("session tokens are url-safe and not reused", () => {
  const token = randomToken();
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.ok(token.length >= 32);
  assert.notEqual(randomToken(), randomToken());
});
