/**
 * BUG-020: /v1/reporting/export-summary must require merchant authentication
 * and be scoped to the caller. Real, migrated Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { recordKycReview } from "../onboarding/review.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("reportingExport.test.ts requires DATABASE_URL to point at a real, migrated Postgres");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  INTERNAL_API_TOKEN: "test-internal-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

async function merchantWithKey(label: string) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Export ${label} ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash) VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  await recordKycReview(pool, { merchantId, outcome: "approved", reviewerIdentifier: "test" });
  const issued = await issueApiKey(pool, config, { merchantId, createdBy: u.rows[0]!.id, label });
  return { merchantId, rawKey: issued.rawKey };
}

test("export-summary rejects anonymous callers and returns only the caller's own volume", async () => {
  const anon = await app.inject({ method: "GET", url: "/v1/reporting/export-summary" });
  assert.equal(anon.statusCode, 401, anon.body);
  const badKey = await app.inject({ method: "GET", url: "/v1/reporting/export-summary", headers: { authorization: "Bearer fp_test_notarealkey" } });
  assert.equal(badKey.statusCode, 401, badKey.body);

  const a = await merchantWithKey("a");
  const b = await merchantWithKey("b");
  await pool.query(
    `INSERT INTO merchant_daily_volume (merchant_id, volume_date, captured_gross_fils) VALUES ($1, current_date, 111), ($2, current_date, 222)`,
    [a.merchantId, b.merchantId],
  );

  const own = await app.inject({ method: "GET", url: "/v1/reporting/export-summary", headers: { authorization: `Bearer ${a.rawKey}` } });
  assert.equal(own.statusCode, 200, own.body);
  assert.equal(own.json().grossFils, 111, "merchant A sees only its own volume, not merchant B's 222");
});
