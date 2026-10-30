import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "./config.js";

const databaseUrl = "postgres://localhost/filspay_test";

test("development leaves acquirer callback signatures optional unless the flag is set", () => {
  const dev = loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "development" });
  assert.equal(dev.acquirerCallbackRequireSignature, false);

  const forced = loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "development",
    ACQUIRER_CALLBACK_REQUIRE_SIGNATURE: "true",
  });
  assert.equal(forced.acquirerCallbackRequireSignature, true);
});

test("test and production require acquirer callback signatures", () => {
  const testEnv = loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  assert.equal(testEnv.acquirerCallbackRequireSignature, true);

  const production = loadConfig({
    DATABASE_URL: databaseUrl,
    NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "test-token",
    ACQUIRER_CALLBACK_SIGNING_SECRET: "test-callback-secret",
    WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    ACQUIRER_CALLBACK_REQUIRE_SIGNATURE: "false",
  });
  assert.equal(production.acquirerCallbackRequireSignature, true);
});
