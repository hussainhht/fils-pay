import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

test("development fallback webhook key is compatible with AES-256-GCM", () => {
  const config = loadConfig({ DATABASE_URL: "postgres://localhost/filspay_test", NODE_ENV: "development" });
  assert.equal(Buffer.from(config.webhookSecretEncryptionKey, "base64").length, 32);
});

test("production still requires an explicit webhook encryption key", () => {
  assert.throws(() => loadConfig({
    DATABASE_URL: "postgres://localhost/filspay_test",
    NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "test-token",
    ACQUIRER_CALLBACK_SIGNING_SECRET: "test-callback-secret",
  }), /WEBHOOK_SECRET_ENCRYPTION_KEY environment variable is not set/);
});
