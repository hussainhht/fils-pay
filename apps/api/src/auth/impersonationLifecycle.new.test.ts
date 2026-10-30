import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { markAdminAuditOutcome } from "../adminAudit/log.js";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("impersonationLifecycle.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  ACQUIRER_FAILURE_RATE: "0",
  ACQUIRER_LATENCY_MIN_MS: "0",
  ACQUIRER_LATENCY_MAX_MS: "1",
});
const app = buildApp(config, pool);
const CARD = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };

test.after(async () => {
  await app.close();
  await pool.end();
});

async function merchant(label: string) {
  const merchantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchants (display_name, mdr_bps, onboarding_status) VALUES ($1, 250, 'approved') RETURNING id`,
      [`${label} ${randomUUID()}`],
    )
  ).rows[0]!.id;
  const email = `owner-${randomUUID()}@merchant.test`;
  const userId = (
    await pool.query<{ id: string }>(
      `INSERT INTO merchant_users (merchant_id, email, password_hash, role)
       VALUES ($1, $2, 'unused', 'owner') RETURNING id`,
      [merchantId, email],
    )
  ).rows[0]!.id;
  const rawKey = randomUUID();
  await pool.query(
    `INSERT INTO api_keys (merchant_id, key_hash, key_prefix, created_by) VALUES ($1, $2, 'fp_test', $3)`,
    [merchantId, sha256Hex(rawKey), userId],
  );
  const sessionRaw = randomToken(32);
  await pool.query(
    `INSERT INTO sessions (merchant_user_id, token_hash, authenticated, expires_at)
     VALUES ($1, $2, true, now() + interval '2 hours')`,
    [userId, sha256Hex(sessionRaw)],
  );
  return {
    merchantId,
    userId,
    rawKey,
    sessionCookie: `${config.cookieName}=${sessionRaw}`,
    email,
  };
}

async function admin(role: "support" | "finance" | "super_admin") {
  const email = `${role}-${randomUUID()}@admin.test`;
  const id = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_users (email, password_hash, display_name, role)
       VALUES ($1, 'unused', $2, $3) RETURNING id`,
      [email, `Test ${role}`, role],
    )
  ).rows[0]!.id;
  const raw = randomToken(32);
  await pool.query(
    `INSERT INTO admin_sessions (admin_user_id, token_hash, authenticated, expires_at)
     VALUES ($1, $2, true, now() + interval '2 hours')`,
    [id, sha256Hex(raw)],
  );
  return { id, email, cookie: `${config.adminCookieName}=${raw}` };
}

async function grantFor(adminUserId: string, merchantId: string) {
  const raw = randomToken(32);
  const row = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_impersonation_grants (admin_user_id, merchant_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '15 minutes') RETURNING id`,
      [adminUserId, merchantId, sha256Hex(raw)],
    )
  ).rows[0]!;
  return { grantId: row.id, cookie: `${config.impersonationCookieName}=${raw}` };
}

test("a super_admin grant is support and is the dashboard identity even beside an owner session", async () => {
  const owner = await merchant("owner-session");
  const target = await merchant("granted");
  const operator = await admin("super_admin");
  const grant = await grantFor(operator.id, target.merchantId);

  const onlyGrant = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie: grant.cookie },
  });
  assert.equal(onlyGrant.statusCode, 200, onlyGrant.body);
  const grantBody = onlyGrant.json();
  assert.equal(grantBody.role, "support");
  assert.equal(grantBody.email, operator.email);
  assert.equal(grantBody.merchant.id, target.merchantId);
  assert.equal(grantBody.impersonation.grantId, grant.grantId);
  assert.notEqual(grantBody.merchant.id, owner.merchantId);

  const both = await app.inject({
    method: "GET",
    url: "/v1/auth/me",
    headers: { cookie: `${owner.sessionCookie}; ${grant.cookie}` },
  });
  assert.equal(both.statusCode, 200, both.body);
  assert.equal(both.json().merchant.id, target.merchantId);
  assert.equal(both.json().role, "support");
  assert.equal(both.json().email, operator.email);
  assert.notEqual(both.json().email, owner.email);
});

test("a live grant refuses capture, void, and API-key mutations, including beside an owner session", async () => {
  const owner = await merchant("writer");
  const operator = await admin("super_admin");
  const grant = await grantFor(operator.id, owner.merchantId);
  const both = `${owner.sessionCookie}; ${grant.cookie}`;

  const authRes = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { authorization: `Bearer ${owner.rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 10000, card: CARD, reference: "grant-deny" },
  });
  assert.equal(authRes.statusCode, 201, authRes.body);
  const txnId = authRes.json().id as string;

  const capture = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txnId}/capture`,
    headers: { cookie: both, "idempotency-key": randomUUID() },
    payload: { amountFils: 10000 },
  });
  assert.equal(capture.statusCode, 403, capture.body);

  const voided = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txnId}/void`,
    headers: { cookie: grant.cookie },
  });
  assert.equal(voided.statusCode, 403, voided.body);

  const issued = await app.inject({
    method: "POST",
    url: `/v1/merchants/${owner.merchantId}/api-keys`,
    headers: { cookie: both },
    payload: { label: "should-not-issue" },
  });
  assert.equal(issued.statusCode, 403, issued.body);
  assert.equal(issued.json().error, "impersonation_read_only");

  const read = await app.inject({
    method: "GET",
    url: "/v1/transactions",
    headers: { cookie: grant.cookie },
  });
  assert.equal(read.statusCode, 200, read.body);

  const captured = await app.inject({
    method: "POST",
    url: `/v1/transactions/${txnId}/capture`,
    headers: { authorization: `Bearer ${owner.rawKey}`, "idempotency-key": randomUUID() },
    payload: { amountFils: 10000 },
  });
  assert.equal(captured.statusCode, 200, captured.body);
});

test("admin logout ends the active impersonation grant", async () => {
  const target = await merchant("logout-grant");
  const operator = await admin("support");
  const grant = await grantFor(operator.id, target.merchantId);

  const before = await app.inject({
    method: "GET",
    url: "/v1/transactions",
    headers: { cookie: grant.cookie },
  });
  assert.equal(before.statusCode, 200, before.body);

  const logout = await app.inject({
    method: "POST",
    url: "/v1/admin/auth/logout",
    headers: { cookie: `${operator.cookie}; ${grant.cookie}` },
  });
  assert.equal(logout.statusCode, 204, logout.body);

  const after = await app.inject({
    method: "GET",
    url: "/v1/transactions",
    headers: { cookie: grant.cookie },
  });
  assert.equal(after.statusCode, 401, after.body);
  const adminMe = await app.inject({
    method: "GET",
    url: "/v1/admin/auth/me",
    headers: { cookie: operator.cookie },
  });
  assert.equal(adminMe.statusCode, 401, adminMe.body);
  const ended = await pool.query<{ ended_at: Date | null }>(
    `SELECT ended_at FROM admin_impersonation_grants WHERE id = $1`,
    [grant.grantId],
  );
  assert.ok(ended.rows[0]!.ended_at);
});

test("ledger lines cannot be updated or deleted, and audit completion can still set outcome and metadata", async () => {
  const target = await merchant("ledger");
  const operator = await admin("finance");
  const groupId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO ledger_entries (entry_group_id, merchant_id, account_id, direction, amount_fils, occurred_at, description)
       VALUES ($1, $2, 'card_scheme_clearing', 'debit', 1000, now(), 'immutability'),
              ($1, $2, 'merchant_payable', 'credit', 1000, now(), 'immutability')`,
      [groupId, target.merchantId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await assert.rejects(
    pool.query(`UPDATE ledger_entries SET description = 'rewritten' WHERE entry_group_id = $1`, [groupId]),
    /append-only/,
  );
  await assert.rejects(
    pool.query(`DELETE FROM ledger_entries WHERE entry_group_id = $1`, [groupId]),
    /append-only/,
  );
  const stillThere = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ledger_entries WHERE entry_group_id = $1`,
    [groupId],
  );
  assert.equal(stillThere.rows[0]!.n, "2");

  const auditId = (
    await pool.query<{ id: string }>(
      `INSERT INTO admin_audit_log (admin_user_id, action, target_type, target_id, metadata, outcome)
       VALUES ($1, 'balance_rebuild', 'platform', NULL, '{"started":true}'::jsonb, 'succeeded')
       RETURNING id`,
      [operator.id],
    )
  ).rows[0]!.id;
  await markAdminAuditOutcome(pool, auditId, "failed", { reason: "completion" });
  const completed = await pool.query<{ outcome: string; metadata: { started?: boolean; reason?: string }; action: string }>(
    `SELECT outcome, metadata, action FROM admin_audit_log WHERE id = $1`,
    [auditId],
  );
  assert.equal(completed.rows[0]!.outcome, "failed");
  assert.equal(completed.rows[0]!.action, "balance_rebuild");
  assert.equal(completed.rows[0]!.metadata.started, true);
  assert.equal(completed.rows[0]!.metadata.reason, "completion");
  await assert.rejects(
    pool.query(`UPDATE admin_audit_log SET action = 'kyc_review' WHERE id = $1`, [auditId]),
    /outcome and metadata/,
  );
  await assert.rejects(pool.query(`DELETE FROM admin_audit_log WHERE id = $1`, [auditId]), /cannot be deleted/);
});
