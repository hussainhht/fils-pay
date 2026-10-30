import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createTestMerchantWithOwner, type SignupInput } from "./signup.js";

const databaseUrl = process.env.DATABASE_URL;
test("public signup stays live; operator signup is atomic, isolated from settlement and can authenticate", { skip: !databaseUrl }, async () => {
  const url = new URL(databaseUrl!);
  assert.ok(["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) && /^\/filspay_test(?:_[a-z0-9_]+)?$/.test(url.pathname) && !url.search, "requires an isolated local test database without connection overrides");
  const pool = new Pool({ connectionString: databaseUrl });
  const config = loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test" });
  const app = buildApp(config, pool);
  const tag = randomUUID();
  const password = "isolated-test-password-not-a-secret";
  const input: SignupInput = { businessProfile: { legalName: `integration-${tag}`, registrationNumber: tag,
    businessType: "other", contactEmail: "test@example.test", contactPhone: "0", addressLine1: "test", city: "test" },
    owner: { email: `test-${tag}@example.test`, password } };
  const ids: string[] = [];
  try {
    const signup = await app.inject({ method: "POST", url: "/v1/merchants/", payload: { ...input, testMode: true } });
    assert.equal(signup.statusCode, 201, signup.body);
    ids.push(signup.json().merchantId);
    const live = await pool.query("SELECT test_mode FROM merchants WHERE id=$1", [ids[0]]);
    assert.equal(live.rows[0].test_mode, false);
    const created = await createTestMerchantWithOwner(pool, config, input);
    ids.push(created.merchantId);
    const row = await pool.query(`SELECT m.test_mode, u.role FROM merchants m JOIN merchant_users u ON u.merchant_id=m.id WHERE m.id=$1 AND u.id=$2`, [created.merchantId, created.ownerUserId]);
    assert.deepEqual(row.rows, [{ test_mode: true, role: "owner" }]);
    const eligible = await pool.query("SELECT id FROM merchants WHERE status='active' AND test_mode=false AND id=$1", [created.merchantId]);
    assert.equal(eligible.rowCount, 0);
    const batches = await pool.query("SELECT id FROM settlement_batches WHERE merchant_id=$1", [created.merchantId]);
    assert.equal(batches.rowCount, 0);
    const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { merchantId: created.merchantId, email: input.owner.email, password } });
    assert.equal(login.statusCode, 200, login.body);
    assert.equal(login.json().authenticated, true);
    const cookie = login.cookies.find((c) => c.name === config.cookieName);
    assert.ok(cookie);
    const me = await app.inject({ method: "GET", url: "/v1/auth/me", cookies: { [cookie.name]: cookie.value } });
    assert.equal(me.statusCode, 200, me.body);
    assert.equal(me.json().merchant.id, created.merchantId);
    const invalid = { ...input, businessProfile: { ...input.businessProfile, legalName: `rollback-${tag}` }, owner: { ...input.owner, email: null } } as unknown as SignupInput;
    await assert.rejects(createTestMerchantWithOwner(pool, config, invalid));
    const rollback = await pool.query("SELECT id FROM merchants WHERE display_name=$1", [`rollback-${tag}`]);
    assert.equal(rollback.rowCount, 0);
  } finally {
    await app.close();
    if (ids.length) {
      await pool.query("DELETE FROM sessions WHERE merchant_user_id IN (SELECT id FROM merchant_users WHERE merchant_id=ANY($1::uuid[]))", [ids]);
      await pool.query("DELETE FROM merchant_users WHERE merchant_id=ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM merchant_business_profiles WHERE merchant_id=ANY($1::uuid[])", [ids]);
      await pool.query("DELETE FROM merchants WHERE id=ANY($1::uuid[])", [ids]);
    }
    await pool.end();
  }
});
