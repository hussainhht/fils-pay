import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const readPackage = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("default tests are database-free and integration entrypoints require preflight", () => {
  const root = readPackage("../package.json");
  assert.equal(root.scripts.test, "npm run test:unit");
  assert.match(root.scripts["test:integration"], /^node ops\/test-database\.mjs &&/);
  assert.match(root.scripts["test:settlement"], /^node ops\/test-database\.mjs &&/);
  for (const workspace of ["api", "reporting"]) {
    assert.match(readPackage(`../apps/${workspace}/package.json`).scripts.test, /^node ..\/..\/ops\/test-database\.mjs &&/);
  }
  for (const name of ["preinstall", "install", "postinstall", "prepare", "prestart", "start", "poststart"]) {
    assert.equal(root.scripts[name], undefined, `no automatic test/data lifecycle: ${name}`);
  }
});

test("database preflight permits only explicit local test destinations", async () => {
  const { assertTestDatabase } = await import("./test-database.mjs");
  for (const url of ["postgres://localhost/filspay_test", "postgresql://127.0.0.1:5433/filspay_test_release?sslmode=disable", "postgres://[::1]/filspay_test_123"]) {
    assert.doesNotThrow(() => assertTestDatabase({ DATABASE_URL: url, NODE_ENV: "test" }));
  }
  for (const url of [undefined, "not-a-url", "postgres://localhost/filspay", "postgres://localhost/filspay_dev", "postgres://db.example.test/filspay_test", "https://localhost/filspay_test", "postgres://localhost/filspay_test?host=remote", "postgres://localhost/filspay_test?dbname=filspay", "postgres://localhost/filspay_test?options=-csearch_path=public", "postgres://localhost/filspay_test?sslmode=disable&service=production"]) {
    assert.throws(() => assertTestDatabase({ DATABASE_URL: url }), /test database:/);
  }
});

test("production and alternate connection settings are refused", async () => {
  const { assertTestDatabase } = await import("./test-database.mjs");
  const env = { DATABASE_URL: "postgres://localhost/filspay_test" };
  assert.throws(() => assertTestDatabase({ ...env, NODE_ENV: "production" }), /test database:/);
  for (const key of ["PGCONN_SETTLEMENT", "SETTLEMENT_DATABASE_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"]) {
    assert.throws(() => assertTestDatabase({ ...env, [key]: "override" }), /test database:/);
  }
});

test("CLI fails before any database connection and never prints credentials", () => {
  const env = { ...process.env, DATABASE_URL: "postgres://private-user:private-password@remote.example/filspay" };
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("./test-database.mjs", import.meta.url))], { env, encoding: "utf8", timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /test database:/);
  assert.doesNotMatch(result.stdout + result.stderr, /private-user|private-password|remote\.example/);
});
