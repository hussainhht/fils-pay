import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import Fastify from "fastify";
import type { Pool } from "pg";
import { loadConfig } from "../config.js";
import { cookiesPlugin } from "../plugins/cookies.js";
import { errorHandler } from "../plugins/errorHandler.js";
import { hashPassword } from "../auth/passwords.js";
import { authRoutes } from "./auth.js";
import { adminAuthRoutes } from "./adminAuth.js";
import { healthRoutes } from "./health.js";
import { generate } from "otplib";
import type { AuthenticatorRow } from "../auth/totp.js";

// Real handlers/crypto/HTTP, in-memory query responses. This does not verify Postgres locks.
async function fixture(t: TestContext, plane: "merchant" | "admin", totp = false) {
  const config = loadConfig({
    DATABASE_URL: "postgres://localhost/filspay_test", NODE_ENV: "production",
    SETTLEMENT_INTERNAL_TOKEN: "fixture-internal", ACQUIRER_CALLBACK_SIGNING_SECRET: "fixture-callback",
    WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    OTP_EMAIL_FROM: "otp@example.test", OTP_RESEND_API_KEY: "fixture-provider-key",
    FEATURE_TOTP: String(totp), TOTP_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
  });
  // Defense in depth: even a manually constructed unsafe Config must not expose production codes.
  config.otpDevExpose = true;
  const email = `${plane}@example.test`;
  const password = "fixture-password-only";
  const passwordHash = await hashPassword(password, config);
  const state = {
    inTransaction: false, authenticated: false, revoked: false, tokenHash: "",
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
    if (q.startsWith(`UPDATE ${challenges} SET consumed_at`)) { state.challenge!.consumed_at = new Date(); return rows(); }
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
  const code = () => /code is (\d+)/.exec(state.sent.at(-1)!.body.text)![1]!;
  return { app, config, state, prefix, login, verify, code, email, password };
}

for (const plane of ["merchant", "admin"] as const) {
  test(`${plane} unenrolled login authenticates without sending email or exposing OTP`, async (t) => {
    const f = await fixture(t, plane);
    const response = await f.login();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().devOtpCode, undefined);
    assert.equal(response.json().authenticated, true);
    assert.equal(f.state.providerCalls, 0);
    assert.equal(f.state.authenticated, true);
    const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
    assert.match(cookie, plane === "merchant" ? /^fp_sid=/ : /^fp_admin_sid=/);
    assert.equal((await f.verify(cookie, "invalid-code")).statusCode, 401);
    assert.equal((await f.app.inject({ method: "GET", url: "/healthz" })).statusCode, 200);
  });

  test(`${plane} login does not depend on email provider availability`, async (t) => {
    const f = await fixture(t, plane); f.state.providerStatus = 500;
    const response = await f.login();
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().authenticated, true);
    assert.equal(f.state.authenticated, true);
    assert.equal(f.state.providerCalls, 0);
    assert.ok(!response.body.includes("private provider details"));
  });

  for (const reason of ["expired", "consumed", "incorrect", "exhausted", "other-plane"] as const) {
    test(`${plane} rejects ${reason} OTP without authenticating`, async (t) => {
      const f = await fixture(t, plane, true); const validCode = await enrollFactor(f); const login = await f.login();
      let cookie = String(login.headers["set-cookie"]).split(";")[0]!;
      if (reason === "expired") f.state.challenge!.expires_at = new Date(0);
      if (reason === "consumed") f.state.challenge!.consumed_at = new Date();
      if (reason === "exhausted") f.state.challenge!.attempt_count = f.state.challenge!.max_attempts;
      if (reason === "other-plane") cookie = cookie.replace(plane === "merchant" ? "fp_sid=" : "fp_admin_sid=", plane === "merchant" ? "fp_admin_sid=" : "fp_sid=");
      const wrong = "invalid-recovery-code";
      const result = await f.verify(cookie, reason === "incorrect" ? wrong : validCode);
      assert.equal(result.statusCode, reason === "expired" || reason === "consumed" ? 410 : reason === "exhausted" ? 429 : 401, result.body);
      assert.equal(f.state.authenticated, false);
      if (reason === "incorrect") assert.equal(f.state.challenge!.attempt_count, 1);
    });
  }

  test(`${plane} login/challenge rate limits prevent a provider submission`, async (t) => {
    const f = await fixture(t, plane, true); await enrollFactor(f); f.state.accountFailures = f.config.loginMaxFailuresPerAccount;
    assert.equal((await f.login()).statusCode, 429);
    assert.equal(f.state.providerCalls, 0);
    f.state.accountFailures = 0; f.state.challengeCount = f.config.otpMaxChallengesPerUser;
    assert.equal((await f.login()).statusCode, 429);
    assert.equal(f.state.providerCalls, 0);
  });

  test(`${plane} missing user and wrong password retain the same error and send nothing`, async (t) => {
    const f = await fixture(t, plane);
    const wrong = await f.login({ password: "wrong-fixture-password" });
    f.state.userMissing = true;
    const missing = await f.login();
    assert.equal(wrong.statusCode, 401);
    assert.equal(missing.statusCode, 401);
    assert.deepEqual(wrong.json(), missing.json());
    assert.equal(f.state.providerCalls, 0);
  });
}

test("removed merchant email resend cannot reset the authenticator guess budget", async (t) => {
  const f = await fixture(t, "merchant", true); await enrollFactor(f); const login = await f.login();
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const resend = () => f.app.inject({ method: "POST", url: `${f.prefix}/otp/resend`, headers: { cookie } });
  assert.equal((await resend()).statusCode, 404);
  assert.equal(f.state.providerCalls, 0);
  f.state.challenge!.attempt_count = 2; f.state.challenge!.created_at = new Date(Date.now() - 31_000);
  assert.equal((await resend()).statusCode, 404);
  assert.equal(f.state.challenge!.attempt_count, 2);
  assert.equal(f.state.challenge!.attempt_count, 2);
  assert.equal(f.state.authenticated, false);
  assert.equal((await resend()).statusCode, 404);
});

const cookieFrom = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"]).split(";")[0]!;

async function enrollFactor(f: Awaited<ReturnType<typeof fixture>>): Promise<string> {
  const first = await f.login();
  assert.equal(first.statusCode, 200, first.body);
  const trusted = cookieFrom(first);
  const start = await f.app.inject({ method: "POST", url: `${f.prefix}/totp/enroll`, headers: { cookie: trusted }, payload: { password: f.password } });
  assert.equal(start.statusCode, 200, start.body);
  const setup = start.json() as { secret: string; enrollmentId: string };
  const confirmed = await f.app.inject({ method: "POST", url: `${f.prefix}/totp/confirm`, headers: { cookie: trusted }, payload: { enrollmentId: setup.enrollmentId, code: await generate({ secret: setup.secret }) } });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  return confirmed.json().recoveryCodes[0] as string;
}

for (const plane of ["merchant", "admin"] as const) {
  test(`${plane} authenticator enrollment requires a session, password, correct origin and no impersonation`, async (t) => {
    const f = await fixture(t, plane, true);
    const first = await f.login();
    const trusted = cookieFrom(first);
    const enroll = (cookie: string, payload = { password: f.password }, origin?: string) => f.app.inject({ method: "POST", url: `${f.prefix}/totp/enroll`, headers: { cookie, ...(origin ? { origin } : {}) }, payload });
    assert.equal((await enroll("" )).statusCode, 401);
    assert.equal((await enroll(trusted, { password: "wrong" })).statusCode, 401);
    assert.equal((await enroll(trusted, undefined, "https://attacker.example")).statusCode, 403);
    assert.equal((await enroll(`${trusted}; fp_impersonation=present`)).statusCode, 403);
    const otherPlane = trusted.replace(plane === "merchant" ? "fp_sid=" : "fp_admin_sid=", plane === "merchant" ? "fp_admin_sid=" : "fp_sid=");
    assert.equal((await enroll(otherPlane)).statusCode, 401);
    const setup = await enroll(trusted);
    assert.equal(setup.statusCode, 200, setup.body);
    assert.equal(setup.headers["cache-control"], "no-store");
    assert.equal(f.state.factor!.enabled_at, null);
    assert.ok(!f.state.factor!.pending_ciphertext!.includes(setup.json().secret));
  });

  test(`${plane} confirmation activates only a valid new factor; login refuses replay and accepts recovery once`, async (t) => {
    const f = await fixture(t, plane, true);
    const trusted = cookieFrom(await f.login());
    const start = await f.app.inject({ method: "POST", url: `${f.prefix}/totp/enroll`, headers: { cookie: trusted }, payload: { password: f.password, userId: "other-user" } });
    assert.equal(start.statusCode, 200, start.body);
    const setup = start.json();
    const token = await generate({ secret: setup.secret, period: 30, digits: 6 });
    const confirm = (code: string) => f.app.inject({ method: "POST", url: `${f.prefix}/totp/confirm`, headers: { cookie: trusted }, payload: { enrollmentId: setup.enrollmentId, code } });
    const activated = await confirm(token);
    assert.equal(activated.statusCode, 200, activated.body);
    assert.equal((await confirm(token)).statusCode, 410);
    const recovery = activated.json().recoveryCodes as string[];
    assert.equal(recovery.length, 10);
    assert.ok(!JSON.stringify(f.state.factor).includes(recovery[0]!));
    const count = f.state.providerCalls;
    f.config.otpDelivery.transport = "disabled";
    let login = await f.login();
    assert.equal(login.json().verificationMethod, "totp");
    assert.equal(login.json().devOtpCode, undefined);
    assert.equal(f.state.providerCalls, count, "no email downgrade for enrolled accounts");
    if (plane === "merchant") assert.equal((await f.app.inject({ method: "POST", url: `${f.prefix}/otp/resend`, headers: { cookie: cookieFrom(login) } })).statusCode, 404);
    assert.equal((await f.verify(cookieFrom(login), token)).statusCode, 401, "confirmation code is already consumed");
    const nextCode = await generate({ secret: setup.secret, period: 30, digits: 6, epoch: Math.floor(Date.now() / 1000) + 30 });
    assert.equal((await f.verify(cookieFrom(login), nextCode)).statusCode, 200);
    login = await f.login();
    assert.equal((await f.verify(cookieFrom(login), nextCode)).statusCode, 401);
    assert.equal((await f.verify(cookieFrom(login), recovery[0]!)).statusCode, 200);
    login = await f.login();
    assert.equal((await f.verify(cookieFrom(login), recovery[0]!)).statusCode, 401);
    assert.equal((await f.verify(cookieFrom(login), recovery[1]!)).statusCode, 200);
    assert.equal(f.state.factor!.recovery_hashes.length, 8);
  });

  test(`${plane} enrollment confirmation binds session, expires, and stops after five incorrect codes`, async (t) => {
    const f = await fixture(t, plane, true);
    const trusted = cookieFrom(await f.login());
    const start = await f.app.inject({ method: "POST", url: `${f.prefix}/totp/enroll`, headers: { cookie: trusted }, payload: { password: f.password } });
    const confirm = () => f.app.inject({ method: "POST", url: `${f.prefix}/totp/confirm`, headers: { cookie: trusted }, payload: { enrollmentId: start.json().enrollmentId, code: "000000" } });
    const expiresAt = f.state.factor!.pending_expires_at;
    f.state.factor!.pending_expires_at = new Date(0); assert.equal((await confirm()).statusCode, 410);
    f.state.factor!.pending_expires_at = expiresAt;
    const session = f.state.factor!.pending_session_id;
    f.state.factor!.pending_session_id = "other-session"; assert.equal((await confirm()).statusCode, 410);
    f.state.factor!.pending_session_id = session;
    // Use a deliberately wrong six-digit token, chosen against the generated secret/window.
    const { acceptedTotpStep } = await import("../auth/totpCrypto.js");
    let invalid = "000000";
    while (await acceptedTotpStep(start.json().secret, invalid, null) !== null) invalid = String(Number(invalid) + 1).padStart(6, "0");
    for (let i = 0; i < 5; i++) assert.equal((await f.app.inject({ method: "POST", url: `${f.prefix}/totp/confirm`, headers: { cookie: trusted }, payload: { enrollmentId: start.json().enrollmentId, code: invalid } })).statusCode, 401);
    assert.equal(f.state.factor!.pending_attempts, 5);
    assert.equal((await confirm()).statusCode, 429);
    assert.equal(f.state.factor!.enabled_at, null);
  });

  test(`${plane} device replacement requires the existing factor and rotates recovery codes only on confirmation`, async (t) => {
    const f = await fixture(t, plane, true);
    const trusted = cookieFrom(await f.login());
    const enroll = (currentCode?: string) => f.app.inject({ method: "POST", url: `${f.prefix}/totp/enroll`, headers: { cookie: trusted }, payload: { password: f.password, currentCode } });
    let start = await enroll();
    const confirm = async (setup: { secret: string; enrollmentId: string }) => f.app.inject({ method: "POST", url: `${f.prefix}/totp/confirm`, headers: { cookie: trusted }, payload: { enrollmentId: setup.enrollmentId, code: await generate({ secret: setup.secret, digits: 6, period: 30 }) } });
    const first = await confirm(start.json()); assert.equal(first.statusCode, 200, first.body);
    const ciphertext = f.state.factor!.secret_ciphertext;
    assert.equal((await enroll()).statusCode, 401);
    start = await enroll(first.json().recoveryCodes[0]); assert.equal(start.statusCode, 200, start.body);
    assert.equal(f.state.factor!.secret_ciphertext, ciphertext);
    assert.equal(f.state.factor!.recovery_hashes.length, 9);
    const replaced = await confirm(start.json()); assert.equal(replaced.statusCode, 200, replaced.body);
    assert.notEqual(f.state.factor!.secret_ciphertext, ciphertext);
    assert.equal(f.state.factor!.recovery_hashes.length, 10);
    assert.notDeepEqual(replaced.json().recoveryCodes, first.json().recoveryCodes);
  });
}
