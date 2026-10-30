import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { generate } from "otplib";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import { hashPassword } from "../auth/passwords.js";

const databaseUrl = process.env.DATABASE_URL;
const cookie = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"]).split(";")[0]!;

// Requires an explicitly supplied isolated, migrated test DB. Never provisions or migrates it.
for (const plane of ["merchant", "admin"] as const) {
  test(`${plane} Postgres TOTP enrollment, concurrent replay/recovery and device replacement`, { skip: !databaseUrl }, async (t) => {
    const url = new URL(databaseUrl!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^\/filspay_test(?:_[a-zA-Z0-9_-]+)?$/.test(url.pathname)) {
      throw new Error("TOTP integration requires an isolated local filspay_test database");
    }
    const config = loadConfig({ DATABASE_URL: databaseUrl, NODE_ENV: "test", FEATURE_TOTP: "true",
      TOTP_SECRET_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
      OTP_DELIVERY_TRANSPORT: "resend", OTP_EMAIL_FROM: "otp@example.test", OTP_RESEND_API_KEY: "fixture-provider-key", OTP_DEV_EXPOSE: "false" });
    const pool = new Pool({ connectionString: databaseUrl, max: 8 });
    const app = buildApp(config, pool);
    t.after(async () => { await app.close(); await pool.end(); });
    const messages: { text: string }[] = [];
    t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      messages.push(JSON.parse(String(init.body)));
      return Response.json({ id: randomUUID() });
    });
    const password = "isolated-fixture-password";
    const passwordHash = await hashPassword(password, config);
    const email = `totp-${randomUUID()}@example.test`;
    let merchantId: string | undefined;
    let userId: string;
    if (plane === "merchant") {
      merchantId = (await pool.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`TOTP ${randomUUID()}`])).rows[0]!.id;
      userId = (await pool.query<{ id: string }>(`INSERT INTO merchant_users (merchant_id, email, password_hash, role) VALUES ($1, $2, $3, 'owner') RETURNING id`, [merchantId, email, passwordHash])).rows[0]!.id;
    } else {
      userId = (await pool.query<{ id: string }>(`INSERT INTO admin_users (email, password_hash, display_name, role) VALUES ($1, $2, 'TOTP fixture', 'finance') RETURNING id`, [email, passwordHash])).rows[0]!.id;
    }
    const prefix = plane === "merchant" ? "/v1/auth" : "/v1/admin/auth";
    const login = () => app.inject({ method: "POST", url: `${prefix}/login`, payload: { merchantId, email, password } });
    const verify = (session: string, code: string) => app.inject({ method: "POST", url: `${prefix}/otp/verify`, headers: { cookie: session }, payload: { code } });
    const first = await login(); assert.equal(first.statusCode, 200);
    assert.equal(first.json().authenticated, true);
    assert.equal(first.json().otpRequired, false);
    const trusted = cookie(first);
    const enroll = (session: string, currentCode?: string) => app.inject({ method: "POST", url: `${prefix}/totp/enroll`, headers: { cookie: session }, payload: { password, currentCode } });
    let start = await enroll(trusted); assert.equal(start.statusCode, 200);
    let setup = start.json() as { secret: string; enrollmentId: string };
    // Resolve code before serializing the HTTP payload.
    async function activate(session: string, data: typeof setup) {
      return app.inject({ method: "POST", url: `${prefix}/totp/confirm`, headers: { cookie: session }, payload: {
        enrollmentId: data.enrollmentId, code: await generateCode(data.secret),
      } });
    }
    async function generateCode(secret: string) { return generate({ secret, digits: 6, period: 30 }); }
    const activated = await activate(trusted, setup); assert.equal(activated.statusCode, 200);
    const recovery = activated.json().recoveryCodes as string[];
    const factors = `${plane}_authenticators`;
    const stored = (await pool.query<{ secret_ciphertext: string; recovery_hashes: string[] }>(`SELECT secret_ciphertext, recovery_hashes FROM ${factors} WHERE user_id = $1`, [userId])).rows[0]!;
    assert.ok(!stored.secret_ciphertext.includes(setup.secret));
    assert.equal(stored.recovery_hashes.length, 10);
    assert.ok(!stored.recovery_hashes.includes(recovery[0]!));
    const otherPrefix = plane === "merchant" ? "/v1/admin/auth" : "/v1/auth";
    assert.equal((await app.inject({ method: "GET", url: `${otherPrefix}/totp`, headers: { cookie: trusted } })).statusCode, 401);

    const one = await login(), two = await login();
    assert.equal(one.json().verificationMethod, "totp"); assert.equal(one.json().devOtpCode, undefined);
    assert.equal(messages.length, 0, "login never sends fallback email");
    const next = await generate({ secret: setup.secret, digits: 6, period: 30, epoch: Math.floor(Date.now() / 1000) + 30 });
    const raced = await Promise.all([verify(cookie(one), next), verify(cookie(two), next)]);
    assert.equal(raced.filter((r) => r.statusCode === 200).length, 1);
    assert.equal(raced.filter((r) => r.statusCode === 401).length, 1);
    const three = await login(), four = await login();
    const recovered = await Promise.all([verify(cookie(three), recovery[0]!), verify(cookie(four), recovery[0]!)]);
    assert.equal(recovered.filter((r) => r.statusCode === 200).length, 1);
    assert.equal(recovered.filter((r) => r.statusCode === 401).length, 1);
    const current = cookie(recovered.find((r) => r.statusCode === 200)!);
    assert.equal((await enroll(current)).statusCode, 401, "replacement requires old factor as well as session/password");
    start = await enroll(current, recovery[1]); assert.equal(start.statusCode, 200);
    setup = start.json();
    const beforeConfirm = (await pool.query<{ secret_ciphertext: string }>(`SELECT secret_ciphertext FROM ${factors} WHERE user_id = $1`, [userId])).rows[0]!;
    assert.equal(beforeConfirm.secret_ciphertext, stored.secret_ciphertext, "old factor remains until confirmation");
    const replaced = await activate(current, setup); assert.equal(replaced.statusCode, 200);
    assert.notDeepEqual(replaced.json().recoveryCodes, recovery);
    assert.equal((await app.inject({ method: "GET", url: `${prefix}/totp`, headers: { cookie: trusted } })).statusCode, 401, "replacement revokes other authenticated sessions");
    if (plane === "merchant") {
      const otherMerchant = (await pool.query<{ id: string }>(`INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`, [`TOTP tenant ${randomUUID()}`])).rows[0]!.id;
      await pool.query(`INSERT INTO merchant_users (merchant_id, email, password_hash, role) VALUES ($1, $2, $3, 'owner')`, [otherMerchant, email, passwordHash]);
      const otherLogin = await app.inject({ method: "POST", url: `${prefix}/login`, payload: { merchantId: otherMerchant, email, password } });
      assert.equal(otherLogin.json().authenticated, true, "same email in another tenant does not inherit the factor");
      assert.equal(otherLogin.json().otpRequired, false);
      assert.equal((await verify(cookie(otherLogin), replaced.json().recoveryCodes[0])).statusCode, 401);
      const otherSession = cookie(otherLogin);
      const status = await app.inject({ method: "GET", url: `${prefix}/totp`, headers: { cookie: otherSession } });
      assert.equal(status.json().enabled, false);
    }
  });
}
