/**
 * Credit creation is finance/super_admin only. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../adminAuth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("adminCredits.new.test.ts requires DATABASE_URL");
}

const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  SETTLEMENT_INTERNAL_TOKEN: "test-settlement-token",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
});

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

function parseCookie(setCookieHeader: string | string[] | undefined, name: string): string {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  for (const header of headers) {
    if (header && header.startsWith(`${name}=`)) return header.split(";")[0] as string;
  }
  throw new Error(`expected a Set-Cookie header for ${name}`);
}

async function signedInAdmin(role: "support" | "finance"): Promise<string> {
  const password = "admin-test-password-9000!";
  const passwordHash = await hashPassword(password, config);
  const email = `credit-role-${randomUUID()}@admin.test`;
  await pool.query(
    `INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, $3, $4)`,
    [email, passwordHash, `Role ${randomUUID().slice(0, 8)}`, role],
  );
  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/login",
    payload: { email, password },
  });
  assert.equal(loginRes.statusCode, 200, loginRes.body);
  assert.equal(loginRes.json().authenticated, true);
  return parseCookie(loginRes.headers["set-cookie"], config.adminCookieName);
}

test("a support admin cannot create a credit", async () => {
  const cookie = await signedInAdmin("support");
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Credit Role ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;

  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchantId}/credits`,
    headers: { cookie },
    payload: { baseAmountFils: 1_000, reasonCode: "goodwill", effectiveDate: "2026-10-30" },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error, "forbidden");

  const rows = await pool.query(`SELECT 1 FROM credit_requests WHERE merchant_id = $1`, [merchantId]);
  assert.equal(rows.rowCount, 0);
});

test("a finance admin can create a credit", async () => {
  const cookie = await signedInAdmin("finance");
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Credit Role ${randomUUID()}`],
  );
  const res = await app.inject({
    method: "POST",
    url: `/v1/admin/merchants/${merchant.rows[0]!.id}/credits`,
    headers: { cookie },
    payload: { baseAmountFils: 1_000, reasonCode: "goodwill", effectiveDate: "2026-10-30" },
  });
  assert.equal(res.statusCode, 201, res.body);
});
