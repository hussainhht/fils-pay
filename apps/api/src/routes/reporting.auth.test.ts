import assert from "node:assert/strict";
import { after, test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const config = loadConfig({
  DATABASE_URL: "postgres://127.0.0.1:5432/filspay",
  NODE_ENV: "test",
});
const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
const app = buildApp(config, pool);

after(async () => {
  await app.close();
  await pool.end();
});

test("GET /v1/reporting/export-summary requires merchant auth", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/reporting/export-summary" });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "unauthenticated");
});
