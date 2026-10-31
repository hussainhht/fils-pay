import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import type { Pool } from "pg";
import { loadConfig } from "../config.js";
import { cookiesPlugin } from "../plugins/cookies.js";
import { errorHandler } from "../plugins/errorHandler.js";
import { hashPassword } from "../auth/passwords.js";
import { hashOtpCode } from "../auth/otp.js";
import { sha256Hex } from "../lib/crypto.js";
import { authRoutes } from "./auth.js";
import { adminAuthRoutes } from "./adminAuth.js";
import { healthRoutes } from "./health.js";
import { generate } from "otplib";
import type { AuthenticatorRow } from "../auth/totp.js";

// Real handlers/crypto/HTTP, in-memory query responses. This does not verify Postgres locks.
async function fixture(t: TestContext, plane: "merchant" | "admin") {
  const config = loadConfig({
    DATABASE_URL: "postgres://localhost/filspay_test", NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "fixture-internal", ACQUIRER_CALLBACK_SIGNING_SECRET: "fixture-callback",
    WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    OTP_EMAIL_FROM: "otp@example.test", OTP_RESEND_API_KEY: "fixture-provider-key",
    OTP_DELIVERY_TRANSPORT: "console", TEST_OTP_MERCHANT_EMAILS: "merchant@example.test", TEST_OTP_ADMIN_EMAILS: "admin@example.test", FEATURE_TOTP: "false", TOTP_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
  });
  const email = `${plane}@example.test`;
  const password = "fixture-password-only";
  const passwordHash = await hashPassword(password, config);
  const state = {
    testMode: true, logged: [] as { code: string; recipient: string }[], inTransaction: false, authenticated: false, revoked: false, tokenHash: "",
    challenge: undefined as undefined | {
      id: string; code_salt: string; code_hash: string; expires_at: Date;
      max_attempts: number; attempt_count: number; consumed_at: Date | null; created_at: Date;
    },
    challengeCount: 0, accountFailures: 0, sent: [] as { body: { to: string[]; text: string }; key: string }[],
    providerStatus: 200, providerCalls: 0, userMissing: false,
    factor: null as AuthenticatorRow | null,
  };
  const query = async (sql: string, values: unknown[] = []) => {
    const q = sql.replace(/\s+/g, " ").trim();
    const rows = (data: unknown[] = []) => ({ rows: data });
    if (q === "BEGIN") { state.inTransaction = true; return rows(); }
    if (q === "COMMIT" || q === "ROLLBACK") { state.inTransaction = false; return rows(); }
    if (q.includes("pg_advisory_xact_lock")) return rows();
    if (q.includes("AS account_failures")) return rows([{ account_failures: state.accountFailures, ip_failures: 0 }]);
    if (q.startsWith("INSERT INTO login_failures")) return rows([{ id: "attempt" }]);
    if (q.startsWith("DELETE FROM login_failures")) return rows();
    if (q.startsWith("INSERT INTO admin_audit_log")) return rows([{ id: "audit-entry" }]);
    if (q.startsWith("SELECT count(*)::int AS n")) return rows([{ n: state.challengeCount }]);
    if (q.startsWith("SELECT id, authenticated FROM")) return rows(state.authenticated && !state.revoked ? [{ id: `${plane}-session`, authenticated: true }] : []);
    if (q.startsWith(`SELECT * FROM ${plane}_authenticators`)) { assert.equal(values[0], `${plane}-user`); return rows(state.factor ? [state.factor] : []); }
    if (q.startsWith("SELECT mu.id, mu.email, m.test_mode")) return rows([{ id: "merchant-user", email, test_mode: state.testMode }]);
    if (q.startsWith("SELECT id, email FROM admin_users")) return rows([{ id: "admin-user", email }]);
    if (q.startsWith("SELECT mu.email, m.test_mode")) return rows([{ email, test_mode: state.testMode }]);
    if (q.startsWith("SELECT email FROM admin_users")) return rows([{ email }]);
    if (q.startsWith("SELECT mu.email, m.id AS merchant_id")) return rows([{ email, merchant_id: "merchant-id", display_name: "Test", onboarding_status: "approved", refunds_enabled: false }]);
    if (q.startsWith(`SELECT id FROM ${plane === "merchant" ? "merchant_users" : "admin_users"}`)) return rows([{ id: `${plane}-user` }]);
    if (q.startsWith(`INSERT INTO ${plane}_authenticators`)) {
      state.factor ??= { user_id: `${plane}-user`, enabled_at: null, secret_ciphertext: null, last_used_step: null, recovery_hashes: [],
        pending_ciphertext: null, pending_id: null, pending_session_id: null, pending_expires_at: null, pending_attempts: 0 };
      Object.assign(state.factor, { pending_ciphertext: values[1], pending_id: values[2], pending_session_id: values[3], pending_expires_at: values[4], pending_attempts: 0 });
      return rows();
    }
    if (q.startsWith(`UPDATE ${plane}_authenticators`)) {
      const factor = state.factor!;
      if (q.includes("secret_ciphertext = pending_ciphertext")) Object.assign(factor, { secret_ciphertext: factor.pending_ciphertext, enabled_at: new Date(), last_used_step: String(values[1]), recovery_hashes: values[2], pending_ciphertext: null, pending_id: null, pending_session_id: null, pending_expires_at: null, pending_attempts: 0 });
      else if (q.includes("pending_attempts = pending_attempts + 1")) factor.pending_attempts++;
      else if (q.includes("last_used_step = $2")) factor.last_used_step = String(values[1]);
      else if (q.includes("recovery_hashes = $2")) factor.recovery_hashes = values[1] as string[];
      else assert.fail("unexpected factor write");
      return rows();
    }
    if (q.includes("password_hash")) {
      assert.equal(values[q.startsWith("SELECT email, password_hash") ? 0 : plane === "merchant" ? 1 : 0], q.startsWith("SELECT email, password_hash") ? `${plane}-user` : email);
      if (state.userMissing) return rows();
      return rows([{ id: `${plane}-user`, merchant_id: "merchant-id", email, role: plane === "merchant" ? "owner" : "finance", password_hash: passwordHash }]);
    }
    const challenges = plane === "merchant" ? "otp_challenges" : "admin_otp_challenges";
    const sessions = plane === "merchant" ? "sessions" : "admin_sessions";
    if (q.includes("s.authenticated = true")) {
      if (!state.authenticated || state.revoked || state.tokenHash !== values[0]) return rows();
      return rows([{ session_id: `${plane}-session`, admin_session_id: `${plane}-session`, merchant_user_id: "merchant-user", admin_user_id: "admin-user", merchant_id: "merchant-id", email, role: plane === "merchant" ? "owner" : "finance" }]);
    }
    if (q.startsWith(`INSERT INTO ${challenges} `)) {
      state.challengeCount++;
      state.challenge = { id: `${plane}-challenge-${state.challengeCount}`, code_salt: String(values[1]), code_hash: String(values[2]),
        expires_at: values[3] as Date, max_attempts: Number(values[4]), attempt_count: Number(values[5] ?? 0), consumed_at: null, created_at: new Date() };
      return rows([{ id: state.challenge.id }]);
    }
    if (q.startsWith(`INSERT INTO ${sessions} `)) {
      assert.match(q, /false/);
      state.tokenHash = String(values[1]); state.authenticated = false;
      return rows([{ id: `${plane}-session` }]);
    }
    if (q.startsWith("SELECT s.id,") && q.includes(`FROM ${sessions} s`)) {
      if (state.authenticated || state.revoked || state.tokenHash !== values[0]) return rows();
      return rows([{ id: `${plane}-session`, merchant_user_id: "merchant-user", admin_user_id: "admin-user", otp_challenge_id: state.challenge?.id }]);
    }
    if (q.startsWith("SELECT id,") && q.includes(`FROM ${challenges} WHERE`)) return rows(state.challenge ? [state.challenge] : []);
    if (q.startsWith(`UPDATE ${challenges} SET consumed_at`)) { if (state.challenge) state.challenge.consumed_at = new Date(); return rows(); }
    if (q.startsWith(`UPDATE ${challenges} SET attempt_count = attempt_count + 1`)) { state.challenge!.attempt_count++; return rows(); }
    if (q.startsWith(`UPDATE ${challenges} SET attempt_count = $2`)) { state.challenge!.attempt_count = Number(values[1]); return rows(); }
    if (q.startsWith(`UPDATE ${sessions} SET otp_challenge_id`)) return rows();
    if (q.startsWith(`UPDATE ${sessions} SET revoked_at`)) { if (!q.includes("AND id <>")) state.revoked = true; return rows(); }
    if (q.startsWith(`UPDATE ${sessions} SET authenticated = true`)) {
      state.authenticated = true; state.tokenHash = String(values[2]); return rows([{ id: `${plane}-session` }]);
    }
    if (q.startsWith("SELECT merchant_id, role FROM merchant_users")) return rows([{ merchant_id: "merchant-id", role: "owner" }]);
    if (q.startsWith("SELECT role FROM admin_users")) return rows([{ role: "finance" }]);
    if (q.startsWith("SELECT email FROM merchant_users")) return rows([{ email }]);
    throw new Error(`Unexpected mock query: ${q}`);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const app = Fastify({ logger: false });
  t.mock.method(app.log, "info", (obj: { code: string; recipient: string }, message: string) => {
    if (message !== "TEST OTP | temporary console delivery") return;
    assert.equal(state.inTransaction, false, "console delivery must follow commit");
    state.logged.push(obj);
  });
  app.decorate("db", pool); app.decorate("config", config);
  app.register(cookiesPlugin); app.setErrorHandler(errorHandler);
  app.register(authRoutes, { prefix: "/v1/auth" });
  app.register(adminAuthRoutes, { prefix: "/v1/admin/auth" });
  app.register(healthRoutes);
  t.after(() => app.close());
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    assert.equal(state.inTransaction, false, "network call must run after commit and client release");
    state.providerCalls++;
    state.sent.push({ body: JSON.parse(String(init.body)), key: new Headers(init.headers).get("Idempotency-Key")! });
    return Response.json(state.providerStatus === 200 ? { id: "mock-email" } : { error: "private provider details" }, { status: state.providerStatus });
  });
  const prefix = plane === "merchant" ? "/v1/auth" : "/v1/admin/auth";
  const login = (overrides: Record<string, unknown> = {}) => app.inject({ method: "POST", url: `${prefix}/login`, payload: {
    merchantId: "merchant-id", email, password, destination: "attacker@example.test", ...overrides,
  } });
  const verify = (cookie: string, code: string) => app.inject({ method: "POST", url: `${prefix}/otp/verify`, headers: { cookie }, payload: { code } });
  const code = () => state.logged.at(-1)!.code;
  return { app, config, state, prefix, login, verify, code, email, password };
}

const cookieOf = (response: { cookies: { name: string; value: string }[] }) => `${response.cookies[0]!.name}=${response.cookies[0]!.value}`;
for (const plane of ["merchant", "admin"] as const) {
  test(`${plane}: devOtp appears only for enabled, eligible test identities`, async t => {
    const f = await fixture(t, plane);
    let response = await f.login();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().devOtp, undefined);
    f.config.otpDevExpose = true;
    response = await f.login();
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().devOtp, f.code());
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal((await f.verify(cookieOf(response), response.json().devOtp)).statusCode, 200);
    if (plane === "merchant") f.state.testMode = false;
    else f.config.otpDelivery.testAdminEmails = [];
    response = await f.login();
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().devOtp, undefined);
    if (plane === "merchant") {
      f.state.testMode = true;
      f.config.otpDelivery.testMerchantEmails = [];
      response = await f.login();
      assert.equal(response.statusCode, 503);
      assert.equal(response.json().devOtp, undefined);
    }
  });
  test(`${plane}: console OTP gates the session, hashes codes, rotates token, and rejects reuse`, async t => {
    const f = await fixture(t, plane);
    const wrong = await f.login({ password: "wrong-password" });
    assert.equal(wrong.statusCode, 401);
    assert.equal(f.state.logged.length, 0);
    const login = await f.login();
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().otpRequired, true);
    assert.equal(login.json().authenticated, false);
    assert.equal(login.json().verificationMethod, "console");
    const code = f.code();
    assert.match(code, /^\d{6}$/);
    assert.equal(f.state.logged[0]!.recipient, f.email);
    assert.notEqual(f.state.challenge!.code_hash, code);
    assert.equal(f.state.challenge!.code_hash, hashOtpCode(code, f.state.challenge!.code_salt));
    assert.ok(!login.body.includes(code));
    const pending = cookieOf(login);
    assert.equal((await f.app.inject({ url: `${f.prefix}/me`, headers: { cookie: pending } })).statusCode, 401);
    assert.equal((await f.verify(pending, "wrong")).statusCode, 401);
    assert.equal(f.state.challenge!.attempt_count, 1);
    const verified = await f.verify(pending, code);
    assert.equal(verified.statusCode, 200);
    assert.equal(verified.json().authenticated, true);
    assert.ok(f.state.challenge!.consumed_at);
    assert.notEqual(cookieOf(verified), pending);
    assert.equal((await f.app.inject({ url: `${f.prefix}/me`, headers: { cookie: cookieOf(verified) } })).statusCode, 200);
    assert.equal((await f.verify(pending, code)).statusCode, 401);
  });
  test(`${plane}: expiry and attempt limits fail closed`, async t => {
    const f = await fixture(t, plane);
    const login = await f.login();
    const pending = cookieOf(login);
    f.state.challenge!.expires_at = new Date(Date.now() - 1);
    assert.equal((await f.verify(pending, f.code())).statusCode, 410);
    f.state.challenge!.expires_at = new Date(Date.now() + 60_000);
    for (let i = 0; i < 5; i++) assert.equal((await f.verify(pending, "wrong")).statusCode, 401);
    assert.equal((await f.verify(pending, f.code())).statusCode, 429);
    assert.equal(f.state.authenticated, false);
    assert.equal(f.state.revoked, true);
  });
  test(`${plane}: a new login supersedes the old OTP and challenge issuance remains limited`, async t => {
    const f = await fixture(t, plane);
    const first = await f.login();
    const oldChallenge = f.state.challenge!;
    const second = await f.login();
    assert.ok(oldChallenge.consumed_at);
    assert.notEqual(f.state.challenge!.id, oldChallenge.id);
    assert.equal((await f.verify(cookieOf(first), f.code())).statusCode, 401);
    assert.equal((await f.verify(cookieOf(second), f.code())).statusCode, 200);
    f.state.challengeCount = f.config.otpMaxChallengesPerUser;
    assert.equal((await f.login()).statusCode, 429);
  });
  test(`${plane}: missing allowlist rejects login without logging or authenticating`, async t => {
    const f = await fixture(t, plane);
    f.config.otpDelivery.testMerchantEmails = [];
    f.config.otpDelivery.testAdminEmails = [];
    assert.equal((await f.login()).statusCode, 503);
    assert.equal(f.state.logged.length, 0);
    assert.equal(f.state.authenticated, false);
  });
  test(`${plane}: pending OTP rechecks current eligibility`, async t => {
    const f = await fixture(t, plane);
    const login = await f.login();
    if (plane === "merchant") f.state.testMode = false;
    else f.config.otpDelivery.testAdminEmails = [];
    assert.equal((await f.verify(cookieOf(login), f.code())).statusCode, 503);
    assert.equal(f.state.authenticated, false);
  });
}
test("live merchant cannot receive console OTP even with an allowlisted email", async t => {
  const f = await fixture(t, "merchant");
  f.state.testMode = false;
  assert.equal((await f.login()).statusCode, 503);
  assert.equal(f.state.logged.length, 0);
  assert.equal(f.state.authenticated, false);
});

