import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import { Pool } from "pg";
import { toFils } from "@filspay/money";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";
import type { AcquirerSimulator } from "../acquirer/types.js";
import { authorizeTransaction } from "../payments/authorize.js";
import { captureTransaction } from "../payments/capture.js";
import { processRefund } from "../payments/processRefund.js";
import { createWebhookEndpoint } from "./create.js";
import { runDispatchPass } from "./dispatcher.js";
import { createFetchTransport } from "./transport.js";
import { enqueueExpiredPaymentLinks } from "../paymentLinks/expire.js";

if (!process.env.DATABASE_URL) throw new Error("auditLifecycle.test.ts requires a migrated DATABASE_URL");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const config = loadConfig({ DATABASE_URL: process.env.DATABASE_URL, NODE_ENV: "test", WEBHOOK_MAX_ATTEMPTS: "2" });
test.after(() => pool.end());
const card = { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" };
const acquirer: AcquirerSimulator = {
  authorize: async () => ({ outcome: "approved", acquirerReference: randomUUID(), latencyMs: 0 }),
  capture: async req => ({ outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 }),
  refund: async req => ({ outcome: "approved", acquirerReference: req.acquirerReference, latencyMs: 0 }),
};
async function merchant() {
  return (await pool.query(`INSERT INTO merchants (display_name,mdr_bps,onboarding_status,refunds_enabled)
    VALUES ('Webhook audit',250,'approved',true) RETURNING id`)).rows[0].id as string;
}

test("real local receiver: capture, partial/full refunds, stable retry identity and no duplicate financial writes", async () => {
  const bodies: Array<{ id: string; type: string; data: Record<string, unknown> }> = [];
  let secret = "";
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    const header = String(req.headers["webhook-signature"]);
    const timestamp = header.split(",")[0]!.slice(2);
    assert.equal(header, `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`);
    const body = JSON.parse(raw);
    assert.equal(req.headers["webhook-delivery-id"], body.id);
    bodies.push(body);
    res.writeHead(bodies.length === 1 ? 500 : 200).end("local receiver");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const merchantId = await merchant();
    const endpoint = await createWebhookEndpoint(pool, config, { merchantId, url: `http://127.0.0.1:${address.port}/`, createdByType: "merchant_session", createdById: randomUUID() });
    secret = endpoint.secret;
    const auth = await authorizeTransaction(pool, acquirer, { merchantId, amountFils: toFils(10000), card, idempotencyKey: randomUUID() });
    assert.equal(auth.statusCode, 201);
    const transactionId = (auth.body as { id: string }).id;
    const capture = { merchantId, transactionId, idempotencyKey: randomUUID(), actor: { type: "system" as const, id: randomUUID() } };
    assert.equal((await captureTransaction(pool, acquirer, capture)).statusCode, 200);
    assert.equal((await captureTransaction(pool, acquirer, capture)).statusCode, 200);
    const localTransport = createFetchTransport(config);
    const sender: typeof localTransport = req => req.url === endpoint.url
      ? localTransport(req) : Promise.resolve({ statusCode: 200, body: "other test receiver" });
    await runDispatchPass(pool, sender, config);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0]!.type, "transaction.captured");
    const pending = (await pool.query("SELECT * FROM webhook_deliveries WHERE endpoint_id=$1", [endpoint.id])).rows[0];
    assert.equal(pending.status, "pending"); assert.equal(pending.attempt_count, 1);
    await pool.query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE id=$1", [pending.id]);
    // A new pass has no in-memory delivery state: persisted work survives a restart.
    await runDispatchPass(pool, sender, config);
    assert.equal(bodies[1]!.id, bodies[0]!.id);
    const refund = { merchantId, transactionId, amountFils: toFils(4000), idempotencyKey: randomUUID(), actor: { type: "merchant_session" as const, id: randomUUID() } };
    assert.equal((await processRefund(pool, acquirer, refund)).statusCode, 200);
    assert.equal((await processRefund(pool, acquirer, refund)).statusCode, 200);
    await runDispatchPass(pool, sender, config);
    assert.equal((await processRefund(pool, acquirer, { ...refund, amountFils: toFils(6000), idempotencyKey: randomUUID() })).statusCode, 200);
    await runDispatchPass(pool, sender, config);
    assert.deepEqual(bodies.slice(2).map(b => [b.type, b.data.amountFils, b.data.status]), [
      ["refund.succeeded", 4000, "partially_refunded"], ["refund.succeeded", 6000, "refunded"],
    ]);
    assert.equal((await pool.query("SELECT count(*)::int n FROM refunds WHERE transaction_id=$1", [transactionId])).rows[0].n, 2);
    assert.equal((await pool.query("SELECT count(*)::int n FROM settlement_batches WHERE merchant_id=$1", [merchantId])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE aggregate_id=$1", [transactionId])).rows[0].n, 3);
    const ledgerBefore = (await pool.query("SELECT count(*)::int n FROM ledger_entries WHERE merchant_id=$1", [merchantId])).rows[0].n;
    await runDispatchPass(pool, sender, config);
    assert.equal((await pool.query("SELECT count(*)::int n FROM ledger_entries WHERE merchant_id=$1", [merchantId])).rows[0].n, ledgerBefore);
    assert.equal(bodies.length, 4);
    await pool.query("UPDATE webhook_endpoints SET status='disabled' WHERE id=$1", [endpoint.id]);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("definitive declines and expired links emit one event under duplicate/concurrent processing", async () => {
  const merchantId = await merchant();
  const endpoint = await createWebhookEndpoint(pool, config, { merchantId, url: `http://audit-${randomUUID()}.test/`, createdByType: "merchant_session", createdById: randomUUID() });
  await pool.query("UPDATE webhook_endpoints SET created_at=now()-interval '2 seconds' WHERE id=$1", [endpoint.id]);
  const input = { merchantId, amountFils: toFils(1000), card, idempotencyKey: randomUUID() };
  const declining: AcquirerSimulator = { ...acquirer, authorize: async () => ({ outcome: "declined", acquirerReference: "declined", latencyMs: 0 }) };
  assert.equal((await authorizeTransaction(pool, declining, input)).statusCode, 402);
  assert.equal((await authorizeTransaction(pool, declining, input)).statusCode, 402);
  const link = (await pool.query(`INSERT INTO payment_links (merchant_id,token,amount_fils,expires_at,created_by_type,created_by_id)
    VALUES ($1,$2,1000,now()-interval '1 second','merchant_session',$3) RETURNING id`, [merchantId, randomUUID(), randomUUID()])).rows[0];
  const events: string[] = [];
  const sender = async (req: { url: string; body: string }) => { if (req.url === endpoint.url) events.push(JSON.parse(req.body).type); return { statusCode: 200, body: "ok" }; };
  await Promise.all([runDispatchPass(pool, sender, config), runDispatchPass(pool, sender, config)]);
  await runDispatchPass(pool, sender, config);
  assert.deepEqual(events.sort(), ["payment.failed", "payment_link.expired"]);
  assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE aggregate_id=$1 AND event_type='payment_link.expired'", [link.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ledger_entries WHERE merchant_id=$1", [merchantId])).rows[0].n, 0);
});

test("unexpected transport exceptions exhaust bounded retries without leaking error details", async () => {
  const merchantId = await merchant();
  const endpoint = await createWebhookEndpoint(pool, config, { merchantId, url: `http://audit-${randomUUID()}.test/`, createdByType: "merchant_session", createdById: randomUUID() });
  await pool.query(`INSERT INTO outbox_events (event_type,aggregate_type,aggregate_id,payload) VALUES ('transaction.voided','transaction',$1,$2)`, [randomUUID(), JSON.stringify({ merchantId })]);
  const sender = async () => { throw new Error("sensitive error must not be logged"); };
  await runDispatchPass(pool, sender, config);
  await pool.query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE endpoint_id=$1", [endpoint.id]);
  await runDispatchPass(pool, sender, config);
  const row = (await pool.query("SELECT * FROM webhook_deliveries WHERE endpoint_id=$1", [endpoint.id])).rows[0];
  assert.equal(row.status, "exhausted"); assert.equal(row.attempt_count, 2);
  assert.equal(row.response_body_excerpt, null);
});

test("capture decline emits once; ambiguous acquirer error is not reported as payment failure", async () => {
  const merchantId = await merchant();
  const auth = await authorizeTransaction(pool, acquirer, { merchantId, amountFils: toFils(1000), card, idempotencyKey: randomUUID() });
  const transactionId = (auth.body as { id: string }).id;
  const input = { merchantId, transactionId, idempotencyKey: randomUUID(), actor: { type: "system" as const, id: randomUUID() } };
  const declining: AcquirerSimulator = { ...acquirer, capture: async req => ({ outcome: "declined", acquirerReference: req.acquirerReference, latencyMs: 0 }) };
  const results = await Promise.all(Array.from({ length: 8 }, () => captureTransaction(pool, declining, input)));
  assert.ok(results.every(result => result.statusCode === 402));
  const rows = (await pool.query("SELECT payload FROM outbox_events WHERE event_type='payment.failed' AND payload->>'transactionId'=$1", [transactionId])).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].payload.stage, "capture");
  const unavailable: AcquirerSimulator = { ...acquirer, authorize: async () => ({ outcome: "error", acquirerReference: "unknown", latencyMs: 0 }) };
  assert.equal((await authorizeTransaction(pool, unavailable, { merchantId, amountFils: toFils(1000), card, idempotencyKey: randomUUID() })).statusCode, 502);
  assert.equal((await pool.query("SELECT count(*)::int n FROM outbox_events WHERE event_type='payment.failed' AND payload->>'merchantId'=$1", [merchantId])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int n FROM ledger_entries WHERE merchant_id=$1", [merchantId])).rows[0].n, 0);
});

test("expiry scanner skips reserved/canceled links and serialization prevents duplicate expiry events", async () => {
  const merchantId = await merchant();
  const links: string[] = [];
  for (const status of ["active", "reserved", "canceled"]) {
    links.push((await pool.query(`INSERT INTO payment_links (merchant_id,token,amount_fils,expires_at,status,created_by_type,created_by_id)
      VALUES ($1,$2,1000,now()-interval '1 second',$3,'merchant_session',$4) RETURNING id`, [merchantId, randomUUID(), status, randomUUID()])).rows[0].id);
  }
  await Promise.all(Array.from({ length: 8 }, () => enqueueExpiredPaymentLinks(pool)));
  await enqueueExpiredPaymentLinks(pool);
  const rows = (await pool.query("SELECT aggregate_id FROM outbox_events WHERE event_type='payment_link.expired' AND aggregate_id=ANY($1::uuid[])", [links])).rows;
  assert.deepEqual(rows.map(r => r.aggregate_id), [links[0]]);
});

test("rollback publishes nothing; an abandoned delivery lease recovers once it expires", async () => {
  const merchantId = await merchant();
  const endpoint = await createWebhookEndpoint(pool, config, { merchantId, url: `http://audit-${randomUUID()}.test/`, createdByType: "merchant_session", createdById: randomUUID() });
  const client = await pool.connect();
  let eventId: string;
  try {
    await client.query("BEGIN");
    eventId = (await client.query(`INSERT INTO outbox_events (event_type,aggregate_type,aggregate_id,payload) VALUES ('transaction.voided','transaction',$1,$2) RETURNING id`, [randomUUID(), JSON.stringify({ merchantId })])).rows[0].id;
    await client.query("ROLLBACK");
  } finally { client.release(); }
  await runDispatchPass(pool, async () => ({ statusCode: 200, body: "ok" }), config);
  assert.equal((await pool.query("SELECT count(*)::int n FROM webhook_deliveries WHERE outbox_event_id=$1", [eventId!])).rows[0].n, 0);
  const event = (await pool.query(`INSERT INTO outbox_events (event_type,aggregate_type,aggregate_id,payload) VALUES ('transaction.voided','transaction',$1,$2) RETURNING id`, [randomUUID(), JSON.stringify({ merchantId })])).rows[0];
  const deliveryId = randomUUID(); const identity = randomUUID();
  await pool.query(`INSERT INTO webhook_deliveries (id,endpoint_id,outbox_event_id,event_type,delivery_event_id,payload,next_attempt_at)
    VALUES ($1,$2,$3,'transaction.voided',$4,$5,now()+interval '1 hour')`, [deliveryId, endpoint.id, event.id, identity, JSON.stringify({ id: identity, type: "transaction.voided", data: { merchantId } })]);
  let calls = 0;
  const sender = async (req: { url: string }) => { if (req.url === endpoint.url) calls++; return { statusCode: 200, body: "ok" }; };
  await runDispatchPass(pool, sender, config); assert.equal(calls, 0);
  await pool.query("UPDATE webhook_deliveries SET next_attempt_at=now() WHERE id=$1", [deliveryId]);
  await Promise.all([runDispatchPass(pool, sender, config), runDispatchPass(pool, sender, config)]);
  assert.equal(calls, 1);
});

test("callback malformed field types/UUID/time return 400 before database access", async () => {
  const app = buildApp(config, pool);
  try {
    for (const overrides of [{ callbackId: {} }, { transactionId: "bad-uuid" }, { occurredAt: "not-a-date" }, { occurredAt: "0" }, { note: [] }]) {
      const payload = { callbackId: randomUUID(), type: "fraud_review.completed", transactionId: randomUUID(), occurredAt: new Date().toISOString(), outcome: "cleared", note: "review", ...overrides };
      const raw = JSON.stringify(payload); const timestamp = Math.floor(Date.now()/1000);
      const signature = `t=${timestamp},v1=${createHmac("sha256", config.acquirerCallbackSigningSecret).update(`${timestamp}.${raw}`).digest("hex")}`;
      const response = await app.inject({ method: "POST", url: "/v1/acquirer/callbacks", payload, headers: { "acquirer-callback-signature": signature } });
      assert.equal(response.statusCode, 400, response.body);
    }
  } finally { await app.close(); }
});
