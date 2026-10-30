import assert from "node:assert/strict";
import { test } from "node:test";
import { generate } from "otplib";
import type { PoolClient } from "pg";
import { loadConfig } from "../config.js";
import { acceptedTotpStep, createRecoveryCodes, createTotpSetup, decryptTotpSecret, encryptTotpSecret, recoveryIndex } from "./totpCrypto.js";
import { verifyAuthenticatorFactor, type AuthenticatorRow } from "./totp.js";

// RFC 6238 SHA-1 test secret (public test vector, not an account credential).
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const key = Buffer.alloc(32, 8).toString("base64");
const config = loadConfig({ DATABASE_URL: "postgres://localhost/filspay_test", NODE_ENV: "test", FEATURE_TOTP: "true", TOTP_SECRET_ENCRYPTION_KEY: key });

test("RFC 6238 SHA-1 vector uses six digits and 30-second periods", async () => {
  assert.equal(await generate({ secret, epoch: 59, digits: 6, period: 30, algorithm: "sha1" }), "287082");
  assert.equal(await acceptedTotpStep(secret, "287082", null, 59), 1);
  assert.equal(await acceptedTotpStep(secret, "287082", 1, 59), null, "accepted time step cannot replay");
  assert.equal(await acceptedTotpStep(secret, "287082", null, 120), null, "expired code outside drift window");
  assert.equal(await acceptedTotpStep(secret, "2870820", null, 59), null);
  assert.equal(await acceptedTotpStep(secret, "abcdef", null, 59), null);
});

test("clock drift is bounded to one step in either direction", async () => {
  for (const offset of [-2, -1, 0, 1, 2]) {
    const epoch = 1_700_000_010;
    const code = await generate({ secret, epoch: epoch + offset * 30, digits: 6, period: 30 });
    const result = await acceptedTotpStep(secret, code, null, epoch);
    assert.equal(result !== null, Math.abs(offset) <= 1);
  }
});

test("setup URI is standard TOTP, plane-labeled and rendered as a local PNG QR", async () => {
  const setup = await createTotpSetup("merchant", "user:fixture@example.test");
  const uri = new URL(setup.uri);
  assert.equal(uri.protocol, "otpauth:"); assert.equal(uri.hostname, "totp");
  assert.equal(uri.searchParams.get("issuer"), "FilsPay merchant");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
  assert.equal(uri.searchParams.get("secret"), setup.secret);
  assert.match(setup.qrDataUrl, /^data:image\/png;base64,/);
});

test("secret encryption is randomized, authenticated, and bound to plane and user", () => {
  const a = encryptTotpSecret(secret, key, "merchant", "user-a");
  assert.notEqual(a, encryptTotpSecret(secret, key, "merchant", "user-a"));
  assert.ok(!a.includes(secret));
  assert.equal(decryptTotpSecret(a, key, "merchant", "user-a"), secret);
  assert.throws(() => decryptTotpSecret(a, key, "admin", "user-a"));
  assert.throws(() => decryptTotpSecret(a, key, "merchant", "user-b"));
  assert.throws(() => decryptTotpSecret(a, Buffer.alloc(32, 9).toString("base64"), "merchant", "user-a"));
  const parts = a.split("."); parts[2] = Buffer.alloc(16).toString("base64");
  assert.throws(() => decryptTotpSecret(parts.join("."), key, "merchant", "user-a"));
});

test("recovery codes have 128 bits, contain no stored plaintext, and cannot cross identities", () => {
  const recovery = createRecoveryCodes("merchant", "user-a");
  assert.equal(new Set(recovery.codes).size, 10);
  for (const [i, code] of recovery.codes.entries()) {
    assert.match(code, /^[a-f0-9]{8}(?:-[a-f0-9]{8}){3}$/);
    assert.ok(!recovery.hashes.includes(code));
    assert.equal(recoveryIndex(code, recovery.hashes, "merchant", "user-a"), i);
    assert.equal(recoveryIndex(code, recovery.hashes, "admin", "user-a"), -1);
    assert.equal(recoveryIndex(code, recovery.hashes, "merchant", "user-b"), -1);
  }
});

for (const plane of ["merchant", "admin"] as const) {
  test(`${plane} factor verification locks row, persists time step and consumes recovery codes once`, async () => {
    const recovery = createRecoveryCodes(plane, "user");
    const row = { user_id: "user", enabled_at: new Date(), secret_ciphertext: encryptTotpSecret(secret, key, plane, "user"),
      last_used_step: null, recovery_hashes: recovery.hashes } as AuthenticatorRow;
    const client = { query: async (sql: string, values: unknown[]) => {
      assert.ok(sql.includes(`${plane}_authenticators`));
      assert.equal(values[0], "user");
      if (sql.startsWith("SELECT")) { assert.match(sql, /FOR UPDATE$/); return { rows: [row] }; }
      if (sql.includes("last_used_step = $2")) row.last_used_step = String(values[1]);
      else if (sql.includes("recovery_hashes = $2")) row.recovery_hashes = values[1] as string[];
      else assert.fail("unexpected write");
      return { rows: [] };
    } } as unknown as PoolClient;
    const code = await generate({ secret, digits: 6, period: 30 });
    assert.equal(await verifyAuthenticatorFactor(client, config, plane, "user", code), true);
    assert.equal(await verifyAuthenticatorFactor(client, config, plane, "user", code), false);
    assert.equal(await verifyAuthenticatorFactor(client, config, plane, "user", recovery.codes[0]!), true);
    assert.equal(await verifyAuthenticatorFactor(client, config, plane, "user", recovery.codes[0]!), false);
    assert.equal(row.recovery_hashes.length, 9);
  });
}

test("enabling TOTP requires a dedicated external 32-byte encryption key", () => {
  for (const value of [undefined, "", "not-base64", Buffer.alloc(16).toString("base64")]) {
    assert.throws(() => loadConfig({ DATABASE_URL: "postgres://localhost/filspay_test", FEATURE_TOTP: "true", TOTP_SECRET_ENCRYPTION_KEY: value }), /TOTP_SECRET_ENCRYPTION_KEY/);
  }
});
