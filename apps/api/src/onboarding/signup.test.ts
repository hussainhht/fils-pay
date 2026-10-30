import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";
import { loadConfig } from "../config.js";
import { createMerchantWithOwner, createTestMerchantWithOwner, type SignupInput } from "./signup.js";

const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://localhost/filspay_test" });
const input: SignupInput = { businessProfile: { legalName: "Test", registrationNumber: "test", businessType: "other",
  contactEmail: "test@example.test", contactPhone: "0", addressLine1: "test", city: "test" },
  owner: { email: "test@example.test", password: "example password" } };

function fakePool(failOwner = false) {
  const calls: { sql: string; values: unknown[] }[] = [];
  const client = { async query(sql: string, values: unknown[] = []) {
    calls.push({ sql, values });
    if (sql.includes("INSERT INTO merchants ")) return { rows: [{ id: "merchant", onboarding_status: "submitted" }] };
    if (sql.includes("INSERT INTO merchant_users")) {
      if (failOwner) throw new Error("owner insert failed");
      return { rows: [{ id: "owner" }] };
    }
    return { rows: [] };
  }, release() {} };
  return { pool: { connect: async () => client } as unknown as Pool, calls };
}

test("normal and operator creation insert their mode inside the owner transaction", async () => {
  for (const [mode, create] of [[false, createMerchantWithOwner], [true, createTestMerchantWithOwner]] as const) {
    const { pool, calls } = fakePool();
    const result = await create(pool, config, input);
    assert.equal(result.ownerUserId, "owner");
    assert.equal(calls[0]!.sql, "BEGIN");
    assert.match(calls[1]!.sql, /INSERT INTO merchants \(display_name, test_mode\)/);
    assert.equal(calls[1]!.values[1], mode);
    assert.match(calls[3]!.sql, /INSERT INTO merchant_users/);
    assert.equal(calls[4]!.sql, "COMMIT");
  }
});

test("owner insertion failure rolls back the merchant transaction", async () => {
  const { pool, calls } = fakePool(true);
  await assert.rejects(createTestMerchantWithOwner(pool, config, input));
  assert.equal(calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(calls.some((call) => call.sql === "COMMIT"), false);
});

test("operator command refuses to run without explicit confirmation", () => {
  const command = fileURLToPath(new URL("./provisionTestMerchant.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", command], { input: "{}", encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /provisioning failed/);
});
