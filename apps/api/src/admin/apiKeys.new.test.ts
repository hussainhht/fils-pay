/**
 * Rotation revokes the previous API key. Requires DATABASE_URL.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { rotateApiKeyAsAdmin } from "./apiKeys.js";
import { issueApiKey } from "../apiKeys/issue.js";
import { verifyApiKey } from "../apiKeys/verify.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("apiKeys.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

test.after(async () => {
  await pool.end();
});

test("rotating an API key sets revoked_at on the previous key", async () => {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`,
    [`Rotate ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const owner = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `owner-${randomUUID()}@example.test`],
  );
  const admin = await pool.query<{ id: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', 'Rotator', 'finance') RETURNING id`,
    [`rotate-${randomUUID()}@admin.test`],
  );

  const original = await issueApiKey(pool, { nodeEnv: "test" }, {
    merchantId,
    createdBy: owner.rows[0]!.id,
    label: "original",
  });
  const rotated = await rotateApiKeyAsAdmin(pool, { nodeEnv: "test" }, {
    merchantId,
    apiKeyId: original.id,
    adminUserId: admin.rows[0]!.id,
  });

  const oldRow = await pool.query<{ revoked_at: Date | null }>(
    `SELECT revoked_at FROM api_keys WHERE id = $1`,
    [original.id],
  );
  assert.ok(oldRow.rows[0]!.revoked_at);
  assert.equal(await verifyApiKey(pool, original.rawKey), null);

  const next = await verifyApiKey(pool, rotated.rawKey);
  assert.equal(next?.apiKeyId, rotated.id);
  assert.equal(next?.merchantId, merchantId);
});
