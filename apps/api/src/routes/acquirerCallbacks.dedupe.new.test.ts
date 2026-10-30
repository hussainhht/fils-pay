/**
 * A repeated acquirer callback_id is acknowledged and does not append a
 * second note. Requires DATABASE_URL and migration 0081.
 */
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../app.js";
import { loadConfig } from "../config.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("acquirerCallbacks.dedupe.new.test.ts requires DATABASE_URL");
}

const secret = "acqsec_dedupe_test_secret";
const config = loadConfig({
  DATABASE_URL: databaseUrl,
  NODE_ENV: "test",
  WEBHOOK_SECRET_ENCRYPTION_KEY: "Y1ZTGTcYbe30GZJebys9w7T3OYZNKewuOH3SUCEdRQk=",
  ACQUIRER_CALLBACK_SIGNING_SECRET: secret,
});
const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const app = buildApp(config, pool);

test.after(async () => {
  await app.close();
  await pool.end();
});

test("POST /v1/acquirer/callbacks stores one note when the same callback_id is delivered twice", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Callback dedupe ${randomUUID()}`],
  );
  const txn = await pool.query<{ id: string }>(
    `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference)
     VALUES ($1, 'captured', 1000, 1000, $2) RETURNING id`,
    [merchant.rows[0]!.id, `acqref_${randomUUID()}`],
  );
  const body = {
    callbackId: `acqcb_${randomUUID()}`,
    type: "fraud_review.completed",
    transactionId: txn.rows[0]!.id,
    occurredAt: new Date().toISOString(),
    outcome: "cleared",
    note: "same callback twice",
  };
  const timestamp = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify(body);
  const header = `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex")}`;
  const send = () =>
    app.inject({
      method: "POST",
      url: "/v1/acquirer/callbacks",
      headers: { "content-type": "application/json", "acquirer-callback-signature": header },
      payload: raw,
    });

  assert.equal((await send()).statusCode, 200);
  assert.equal((await send()).statusCode, 200);
  const notes = await pool.query(`SELECT count(*)::text AS count FROM acquirer_callback_notes WHERE callback_id = $1`, [
    body.callbackId,
  ]);
  assert.equal(notes.rows[0]!.count, "1");
});
