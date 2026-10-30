import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { generate } from "otplib";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { verifyApiKey } from "../apiKeys/verify.js";
import { lookupPendingSession } from "../auth/sessions.js";
import { lookupPendingAdminSession } from "../adminAuth/sessions.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("auth-security.new.test.ts requires a migrated disposable DATABASE_URL");
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  OTP_DEV_EXPOSE: "true",
  FEATURE_TOTP: "true",
  TOTP_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});
const pool = new Pool({ connectionString: databaseUrl, max: 8 });
const app = buildApp(config, pool);
const password = "auth-regression-password-923!";
let passwordHash: string;
test.before(async () => { passwordHash = await hashPassword(password, config); });
test.after(async () => { await app.close(); await pool.end(); });

function cookieFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(value, "OTP verification must return the promoted session cookie");
  return value.split(";")[0]!;
}
function rawCookie(cookie: string): string { return cookie.slice(cookie.indexOf("=") + 1); }
function wrongCode(_code: string): string { return "invalid-recovery-code"; }

async function enableAuthenticator(prefix: string, cookie: string): Promise<string> {
  const start = await app.inject({ method: "POST", url: `${prefix}/totp/enroll`, headers: { cookie }, payload: { password } });
  assert.equal(start.statusCode, 200, start.body);
  const setup = start.json() as { secret: string; enrollmentId: string };
  const confirmed = await app.inject({ method: "POST", url: `${prefix}/totp/confirm`, headers: { cookie }, payload: { enrollmentId: setup.enrollmentId, code: await generate({ secret: setup.secret }) } });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  return confirmed.json().recoveryCodes[0] as string;
}

async function merchant(email = `auth-${randomUUID()}@example.test`) {
  const m = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`, [`Auth ${randomUUID()}`],
  );
  const merchantId = m.rows[0]!.id;
  const u = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, password_hash, role)
     VALUES ($1, $2, $3, 'owner') RETURNING id`, [merchantId, email, passwordHash],
  );
  return { merchantId, userId: u.rows[0]!.id, email };
}

async function pendingMerchant(email?: string) {
  const identity = await merchant(email);
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { ...identity, password } });
  assert.equal(login.statusCode, 200, login.body);
  const code = await enableAuthenticator("/v1/auth", cookieFrom(login.headers["set-cookie"]));
  const second = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { ...identity, password } });
  assert.equal(second.statusCode, 200, second.body);
  const cookie = cookieFrom(second.headers["set-cookie"]);
  const pending = await lookupPendingSession(pool, rawCookie(cookie));
  assert.ok(pending?.otpChallengeId);
  return { ...identity, cookie, code, pending };
}

async function pendingAdmin() {
  const email = `auth-${randomUUID()}@admin.test`;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, $2, 'Auth regression', 'finance') RETURNING id`, [email, passwordHash],
  );
  const login = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });
  assert.equal(login.statusCode, 200, login.body);
  const code = await enableAuthenticator("/v1/admin/auth", cookieFrom(login.headers["set-cookie"]));
  const second = await app.inject({ method: "POST", url: "/v1/admin/auth/login", payload: { email, password } });
  assert.equal(second.statusCode, 200, second.body);
  const cookie = cookieFrom(second.headers["set-cookie"]);
  const pending = await lookupPendingAdminSession(pool, rawCookie(cookie));
  assert.ok(pending?.otpChallengeId);
  return { userId: user.rows[0]!.id, cookie, code, pending };
}

test("merchant pending cookie is denied; OTP rotates token and extends browser/server TTL", async () => {
  const fixture = await pendingMerchant();
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: fixture.cookie } })).statusCode, 401);
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } });
  assert.equal(verify.statusCode, 200, verify.body);
  const cookie = cookieFrom(verify.headers["set-cookie"]);
  assert.notEqual(cookie, fixture.cookie);
  assert.match(String(verify.headers["set-cookie"]), new RegExp(`Max-Age=${config.sessionTtlHours * 3600}(?:;|$)`));
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: fixture.cookie } })).statusCode, 401);
  const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().merchant.id, fixture.merchantId);
  const stored = await pool.query<{ expires_at: Date; authenticated: boolean }>(`SELECT expires_at, authenticated FROM sessions WHERE id = $1`, [fixture.pending.sessionId]);
  assert.equal(stored.rows[0]!.authenticated, true);
  assert.ok(stored.rows[0]!.expires_at.getTime() > Date.now() + (config.sessionTtlHours * 3600 - 10) * 1000);
});

test("OTP challenge, pending session and verified identity retain the requested tenant for a shared email", async () => {
  const email = `shared-${randomUUID()}@example.test`;
  await merchant(email);
  const fixture = await pendingMerchant(email);
  assert.equal(fixture.pending.merchantUserId, fixture.userId);
  const challenge = await pool.query<{ merchant_user_id: string }>(`SELECT merchant_user_id FROM otp_challenges WHERE id = $1`, [fixture.pending.otpChallengeId]);
  assert.equal(challenge.rows[0]!.merchant_user_id, fixture.userId);
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } });
  assert.equal(verify.statusCode, 200, verify.body);
  assert.equal(verify.json().merchantId, fixture.merchantId);
});

test("admin OTP rotates token, denies the copied pending cookie, and grants full cookie TTL", async () => {
  const fixture = await pendingAdmin();
  assert.equal((await app.inject({ method: "GET", url: "/v1/admin/auth/me", headers: { cookie: fixture.cookie } })).statusCode, 401);
  const verify = await app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } });
  assert.equal(verify.statusCode, 200, verify.body);
  const cookie = cookieFrom(verify.headers["set-cookie"]);
  assert.notEqual(cookie, fixture.cookie);
  assert.match(String(verify.headers["set-cookie"]), new RegExp(`Max-Age=${config.adminSessionTtlHours * 3600}(?:;|$)`));
  assert.equal((await app.inject({ method: "GET", url: "/v1/admin/auth/me", headers: { cookie: fixture.cookie } })).statusCode, 401);
  const me = await app.inject({ method: "GET", url: "/v1/admin/auth/me", headers: { cookie } });
  assert.equal(me.statusCode, 200, me.body);
  assert.equal(me.json().adminUserId, fixture.userId);
});

for (const plane of ["merchant", "admin"] as const) {
  test(`${plane} concurrent OTP failures cannot exceed the guess budget`, async () => {
    const fixture = plane === "merchant" ? await pendingMerchant() : await pendingAdmin();
    const url = plane === "merchant" ? "/v1/auth/otp/verify" : "/v1/admin/auth/otp/verify";
    const table = plane === "merchant" ? "otp_challenges" : "admin_otp_challenges";
    const max = plane === "merchant" ? config.otpMaxAttempts : config.adminOtpMaxAttempts;
    const attempts = await Promise.all(Array.from({ length: max + 7 }, () => app.inject({
      method: "POST", url, headers: { cookie: fixture.cookie }, payload: { code: wrongCode(fixture.code) },
    })));
    assert.equal(attempts.filter((r) => r.json().error === "invalid_code").length, max);
    assert.ok(attempts.some((r) => r.statusCode === 429));
    assert.ok(attempts.every((r) => r.statusCode === 401 || r.statusCode === 429));
    const stored = await pool.query<{ attempt_count: number }>(`SELECT attempt_count FROM ${table} WHERE id = $1`, [fixture.pending.otpChallengeId]);
    assert.equal(stored.rows[0]!.attempt_count, max, "failed guesses must commit exactly once and stop at the limit");
    assert.notEqual((await app.inject({ method: "POST", url, headers: { cookie: fixture.cookie }, payload: { code: fixture.code } })).statusCode, 200);
  });

  test(`${plane} concurrent valid OTP requests promote exactly once`, async () => {
    const fixture = plane === "merchant" ? await pendingMerchant() : await pendingAdmin();
    const url = plane === "merchant" ? "/v1/auth/otp/verify" : "/v1/admin/auth/otp/verify";
    const replies = await Promise.all(Array.from({ length: 5 }, () => app.inject({ method: "POST", url, headers: { cookie: fixture.cookie }, payload: { code: fixture.code } })));
    assert.equal(replies.filter((r) => r.statusCode === 200).length, 1);
    assert.equal(replies.filter((r) => r.statusCode === 401).length, 4);
  });
}

test("removed resend cannot reset guesses on a pending authenticator challenge", async () => {
  const fixture = await pendingMerchant();
  for (let i = 0; i < 2; i++) {
    const result = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: wrongCode(fixture.code) } });
    assert.equal(result.json().error, "invalid_code");
  }
  await pool.query(`UPDATE otp_challenges SET created_at = now() - interval '31 seconds' WHERE id = $1`, [fixture.pending.otpChallengeId]);
  const replies = await Promise.all(Array.from({ length: 2 }, () => app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie: fixture.cookie } })));
  assert.ok(replies.every((r) => r.statusCode === 404));
  const current = await lookupPendingSession(pool, rawCookie(fixture.cookie));
  assert.ok(current?.otpChallengeId);
  assert.equal(current.otpChallengeId, fixture.pending.otpChallengeId);
  const challenge = await pool.query<{ attempt_count: number; max_attempts: number }>(`SELECT attempt_count, max_attempts FROM otp_challenges WHERE id = $1`, [current.otpChallengeId]);
  assert.equal(challenge.rows[0]!.attempt_count, 2);
  for (let i = 2; i < challenge.rows[0]!.max_attempts; i++) {
    assert.equal((await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: wrongCode(fixture.code) } })).json().error, "invalid_code");
  }
  const exhausted = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } });
  assert.equal(exhausted.statusCode, 429);
});

test("expired authenticator challenge cannot be resent or verified", async () => {
  const fixture = await pendingMerchant();
  await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: wrongCode(fixture.code) } });
  await pool.query(`UPDATE otp_challenges SET created_at = now() - interval '6 minutes', expires_at = now() - interval '1 minute' WHERE id = $1`, [fixture.pending.otpChallengeId]);
  const resent = await app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie: fixture.cookie } });
  assert.equal(resent.statusCode, 404, resent.body);
  const current = await lookupPendingSession(pool, rawCookie(fixture.cookie));
  assert.ok(current?.otpChallengeId);
  const stored = await pool.query<{ attempt_count: number }>(`SELECT attempt_count FROM otp_challenges WHERE id = $1`, [current.otpChallengeId]);
  assert.equal(stored.rows[0]!.attempt_count, 1);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } })).statusCode, 410);
});

test("verify racing removed resend cannot lose a failed guess", async () => {
  const fixture = await pendingMerchant();
  await pool.query(`UPDATE otp_challenges SET created_at = now() - interval '31 seconds' WHERE id = $1`, [fixture.pending.otpChallengeId]);
  const [verify, resend] = await Promise.all([
    app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: "not-a-numeric-otp" } }),
    app.inject({ method: "POST", url: "/v1/auth/otp/resend", headers: { cookie: fixture.cookie } }),
  ]);
  assert.equal(verify.statusCode, 401, verify.body);
  assert.equal(verify.json().error, "invalid_code");
  assert.equal(resend.statusCode, 404, resend.body);
  const current = await lookupPendingSession(pool, rawCookie(fixture.cookie));
  assert.ok(current?.otpChallengeId);
  const stored = await pool.query<{ attempt_count: number }>(`SELECT attempt_count FROM otp_challenges WHERE id = $1`, [current.otpChallengeId]);
  assert.equal(stored.rows[0]!.attempt_count, 1);
});

test("merchant suspension invalidates authenticated sessions and API keys; scheduled key expiry is enforced", async () => {
  const fixture = await pendingMerchant();
  const verify = await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } });
  assert.equal(verify.statusCode, 200, verify.body);
  const cookie = cookieFrom(verify.headers["set-cookie"]);
  const key = await issueApiKey(pool, config, { merchantId: fixture.merchantId, createdBy: fixture.userId });
  assert.ok(await verifyApiKey(pool, key.rawKey));
  await pool.query(`UPDATE api_keys SET revoke_after = now() - interval '1 second' WHERE id = $1`, [key.id]);
  assert.equal(await verifyApiKey(pool, key.rawKey), null);
  await pool.query(`UPDATE api_keys SET revoke_after = now() + interval '1 hour' WHERE id = $1`, [key.id]);
  assert.ok(await verifyApiKey(pool, key.rawKey));
  await pool.query(`UPDATE merchants SET status = 'suspended' WHERE id = $1`, [fixture.merchantId]);
  assert.equal(await verifyApiKey(pool, key.rawKey), null);
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })).statusCode, 401);
});

test("suspending an account during OTP prevents promotion", async () => {
  const fixture = await pendingMerchant();
  await pool.query(`UPDATE merchants SET status = 'suspended' WHERE id = $1`, [fixture.merchantId]);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/otp/verify", headers: { cookie: fixture.cookie }, payload: { code: fixture.code } })).statusCode, 401);
  const admin = await pendingAdmin();
  await pool.query(`UPDATE admin_users SET status = 'disabled' WHERE id = $1`, [admin.userId]);
  assert.equal((await app.inject({ method: "POST", url: "/v1/admin/auth/otp/verify", headers: { cookie: admin.cookie }, payload: { code: admin.code } })).statusCode, 401);
});
