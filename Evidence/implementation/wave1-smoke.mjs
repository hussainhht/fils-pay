// Run inside the API container of a disposable development stack:
// docker exec -i <api-container> node --input-type=module < this-file
// Creates one synthetic merchant. Never prints passwords, OTPs, tokens, or keys.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = new URL(process.env.FILSPAY_SMOKE_API_URL ?? "http://127.0.0.1:3000");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Use a disposable localhost API");
assert.notEqual(process.env.NODE_ENV, "production", "Use a development/test stack");
const request = (path, options) => fetch(new URL(path, base), options);
const jsonPost = (payload, cookie) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(payload),
});
const cookieFrom = (response) => {
  const header = response.headers.get("set-cookie");
  assert.ok(header, "Expected a session cookie");
  return header.split(";")[0];
};

assert.equal((await request("/healthz")).status, 200);
const suffix = randomUUID();
const email = `wave1-${suffix}@example.test`;
const password = `Disposable-${randomUUID()}!`;
const signup = await request("/v1/merchants", jsonPost({
  businessProfile: {
    legalName: `Wave 1 smoke ${suffix}`,
    registrationNumber: `RC-${suffix.slice(0, 8)}`,
    businessType: "llc",
    contactEmail: email,
    contactPhone: "+97300000000",
    addressLine1: "1 Test Street",
    city: "Manama",
  },
  owner: { email, password },
}));
assert.equal(signup.status, 201, await signup.clone().text());
const { merchantId } = await signup.json();
const login = await request("/v1/auth/login", jsonPost({ merchantId, email, password }));
assert.equal(login.status, 200);
const pendingCookie = cookieFrom(login);
const loginBody = await login.json();
assert.ok(loginBody.devOtpCode, "Disposable development API must expose its test OTP");
assert.equal((await request("/v1/auth/me", { headers: { cookie: pendingCookie } })).status, 401);
const verify = await request("/v1/auth/otp/verify", jsonPost({ code: loginBody.devOtpCode }, pendingCookie));
assert.equal(verify.status, 200);
const authenticatedCookie = cookieFrom(verify);
assert.notEqual(authenticatedCookie, pendingCookie);
const fullTtlSeconds = Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600;
assert.match(verify.headers.get("set-cookie"), new RegExp(`Max-Age=${fullTtlSeconds}(?:;|$)`));
assert.equal((await request("/v1/auth/me", { headers: { cookie: pendingCookie } })).status, 401);
const me = await request("/v1/auth/me", { headers: { cookie: authenticatedCookie } });
assert.equal(me.status, 200);
assert.equal((await me.json()).merchant.id, merchantId);

const settlement = process.env.SETTLEMENT_INTERNAL_URL;
assert.ok(settlement && process.env.SETTLEMENT_INTERNAL_TOKEN, "Internal settlement configuration required");
const endpoint = new URL("/internal/run-batch", settlement);
assert.equal((await fetch(endpoint)).status, 401);
assert.equal((await fetch(endpoint, { headers: { authorization: "Bearer incorrect-validation-token" } })).status, 401);
assert.equal((await fetch(endpoint, {
  headers: { authorization: `Bearer ${process.env.SETTLEMENT_INTERNAL_TOKEN}` },
})).status, 405); // Authentication succeeds; GET safely performs no settlement work.
assert.equal(Buffer.from(process.env.WEBHOOK_SECRET_ENCRYPTION_KEY, "base64").length, 32);
console.log("PASS: health, signup/login, pending 401, OTP token rotation/full TTL, authenticated identity, settlement bearer enforcement, 32-byte webhook key");
