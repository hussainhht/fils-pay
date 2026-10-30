import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { verifyPassword } from "../auth/passwords.js";
import { createAdminUser } from "./provisionAdmin.js";

const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://localhost/filspay_test" });

test("admin insert stores role and an argon2id hash, never the plaintext", async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  const pool = { async query(sql: string, values: unknown[]) { calls.push({ sql, values }); return { rows: [{ id: "admin" }] }; } };
  const password = "correct horse battery staple 1";
  const result = await createAdminUser(pool as never, config, { email: "a@example.test", displayName: "A", role: "finance", password });
  assert.equal(result.adminUserId, "admin");
  assert.match(calls[0]!.sql, /INSERT INTO admin_users/);
  assert.equal(calls[0]!.values[3], "finance");
  const hash = String(calls[0]!.values[1]);
  assert.match(hash, /^\$argon2id\$/);
  assert.equal(await verifyPassword(hash, password), true);
});

test("admin command refuses to run without explicit confirmation", () => {
  const command = fileURLToPath(new URL("./provisionAdmin.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx", command], { input: "{}", encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /provisioning failed/);
});
