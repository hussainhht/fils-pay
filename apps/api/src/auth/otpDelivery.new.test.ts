import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import { AppError } from "../lib/errors.js";
import { sendOtpCode } from "./notifier.js";
import { sendAdminOtpCode } from "../adminAuth/notifier.js";

const env = {
  DATABASE_URL: "postgres://localhost/filspay_test",
  NODE_ENV: "production",
  SETTLEMENT_INTERNAL_TOKEN: "fixture-internal",
  ACQUIRER_CALLBACK_SIGNING_SECRET: "fixture-callback",
  WEBHOOK_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  OTP_EMAIL_FROM: "otp@example.test",
  OTP_RESEND_API_KEY: "fixture-provider-key",
};
const challenge = () => ({ id: "challenge-123", code: "739201", expiresAt: new Date(Date.now() + 300_000) });
const unavailable = (err: unknown) => err instanceof AppError && err.statusCode === 503 && err.code === "otp_delivery_unavailable";

for (const plane of ["merchant", "admin"] as const) {
  test(`${plane} notifier sends one email to its stored recipient with isolated idempotency and no sensitive logs`, async () => {
    const config = loadConfig(env);
    const logs: unknown[] = [];
    const log = { info: (...args: unknown[]) => { logs.push(args); } };
    const sent: RequestInit[] = [];
    const mockFetch: typeof fetch = async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(init?.redirect, "error");
      sent.push(init!);
      return Response.json({ id: "provider-message" });
    };
    const otp = challenge();
    if (plane === "merchant") await sendOtpCode(log, config, { merchantUserId: "merchant-user", email: "merchant@example.test" }, otp, mockFetch);
    else await sendAdminOtpCode(log, config, { adminUserId: "admin-user", email: "admin@example.test" }, otp, mockFetch);
    assert.equal(sent.length, 1);
    const request = sent[0]!;
    const body = JSON.parse(String(request.body));
    assert.deepEqual(body.to, [`${plane}@example.test`]);
    assert.equal(body.from, env.OTP_EMAIL_FROM);
    assert.match(body.text, new RegExp(otp.code));
    assert.match(body.text, new RegExp(plane));
    const headers = new Headers(request.headers);
    assert.equal(headers.get("Idempotency-Key"), `filspay-otp/${plane}/${otp.id}`);
    assert.equal(headers.get("Authorization"), `Bearer ${env.OTP_RESEND_API_KEY}`);
    for (const value of [otp.code, env.OTP_RESEND_API_KEY, body.to[0]]) assert.ok(!JSON.stringify(logs).includes(value));
  });
}

test("provider errors, malformed success, and network errors are sanitized and never retried", async () => {
  const config = loadConfig(env);
  for (const mock of [
    async () => new Response("sensitive provider error", { status: 429 }),
    async () => Response.json({ error: "sensitive provider error" }),
    async () => { throw new Error("sensitive provider error"); },
  ]) {
    let attempts = 0;
    await assert.rejects(sendOtpCode({ info: () => assert.fail("no success log") }, config,
      { merchantUserId: "user", email: "merchant@example.test" }, challenge(), async () => { attempts++; return mock(); }), unavailable);
    assert.equal(attempts, 1);
  }
});

test("timeout aborts a single send without leaking or starting retries", async () => {
  const config = loadConfig({ ...env, OTP_DELIVERY_TIMEOUT_MS: "100" });
  let signal: AbortSignal | undefined;
  let attempts = 0;
  await assert.rejects(sendAdminOtpCode({ info: () => assert.fail("must not log success") }, config,
    { adminUserId: "user", email: "admin@example.test" }, challenge(), async (_url, init) => {
      signal = init!.signal!; attempts++;
      return new Promise<Response>(() => {});
    }), unavailable);
  assert.equal(signal?.aborted, true);
  assert.equal(attempts, 1);
});

test("timeout also bounds a stalled successful response body", async () => {
  const config = loadConfig({ ...env, OTP_DELIVERY_TIMEOUT_MS: "100" });
  await assert.rejects(sendOtpCode({ info: () => assert.fail("must not log success") }, config,
    { merchantUserId: "user", email: "merchant@example.test" }, challenge(), async () =>
      new Response(new ReadableStream({ start() {} }))), unavailable);
});

test("re-submitting the same challenge uses the same provider key and payload", async () => {
  const config = loadConfig(env);
  const requests: RequestInit[] = [];
  const mockFetch: typeof fetch = async (_url, init) => { requests.push(init!); return Response.json({ id: "message" }); };
  const otp = challenge();
  for (let i = 0; i < 2; i++) await sendOtpCode({ info() {} }, config,
    { merchantUserId: "user", email: "merchant@example.test" }, otp, mockFetch);
  assert.equal(new Headers(requests[0]!.headers).get("Idempotency-Key"), new Headers(requests[1]!.headers).get("Idempotency-Key"));
  assert.equal(requests[0]!.body, requests[1]!.body);
});

test("development/test transport never sends or logs codes", async () => {
  for (const nodeEnv of ["development", "test"]) {
    const config = loadConfig({ DATABASE_URL: env.DATABASE_URL, NODE_ENV: nodeEnv });
    const logs: unknown[] = [];
    const otp = challenge();
    await sendOtpCode({ info: (...args) => { logs.push(args); } }, config,
      { merchantUserId: "user", email: "merchant@example.test" }, otp, async () => assert.fail("no real send"));
    assert.ok(!JSON.stringify(logs).includes(otp.code));
    assert.match(JSON.stringify(logs), /disabled/);
  }
});

test("production configuration fails closed for missing settings, development exposure or unsafe timeout", () => {
  for (const patch of [
    { OTP_RESEND_API_KEY: "" }, { OTP_EMAIL_FROM: "" },
    { OTP_EMAIL_FROM: "one@example.test,two@example.test" },
    { OTP_EMAIL_FROM: "one@example.test,extra" },
    { OTP_DELIVERY_TRANSPORT: "development" }, { OTP_DELIVERY_TRANSPORT: "unknown" },
    { OTP_DELIVERY_TRANSPORT: "disabled" },
    { OTP_DEV_EXPOSE: "true" }, { OTP_DEV_EXPOSE: "1" },
    { OTP_DELIVERY_TIMEOUT_MS: "0" }, { OTP_DELIVERY_TIMEOUT_MS: "Infinity" },
    { OTP_DELIVERY_TIMEOUT_MS: "100junk" }, { OTP_DELIVERY_TIMEOUT_MS: "30001" },
  ]) assert.throws(() => loadConfig({ ...env, ...patch }), /loadConfig:.*OTP|loadConfig: resend/);
  assert.equal(loadConfig(env).otpDevExpose, false);
});

test("production TOTP-only mode disables email securely instead of requiring a delivery provider", async () => {
  const config = loadConfig({ ...env, FEATURE_TOTP: "true", TOTP_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    OTP_DELIVERY_TRANSPORT: "disabled", OTP_RESEND_API_KEY: "", OTP_EMAIL_FROM: "" });
  assert.equal(config.otpDevExpose, false);
  await assert.rejects(sendOtpCode({ info: () => assert.fail("must not pretend delivery succeeded") }, config,
    { merchantUserId: "user", email: "merchant@example.test" }, challenge(), async () => assert.fail("no real mail")), unavailable);
});

test("invalid persisted recipients and expired codes are refused before any provider request", async () => {
  const config = loadConfig(env);
  const log = { info: () => assert.fail("must not log success") };
  const mockFetch: typeof fetch = async () => assert.fail("must not submit invalid message");
  await assert.rejects(sendOtpCode(log, config, { merchantUserId: "user", email: "one@example.test,two@example.test" }, challenge(), mockFetch), unavailable);
  await assert.rejects(sendOtpCode(log, config, { merchantUserId: "user", email: "merchant@example.test" }, { ...challenge(), expiresAt: new Date(0) }, mockFetch), unavailable);
  await assert.rejects(sendOtpCode(log, { ...config, otpDelivery: { ...config.otpDelivery, transport: "development" } },
    { merchantUserId: "user", email: "merchant@example.test" }, challenge(), mockFetch), unavailable);
});
