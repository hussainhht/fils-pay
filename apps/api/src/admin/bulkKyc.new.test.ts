/**
 * Bulk KYC only approves merchants already under review, and writes a review row.
 * Requires DATABASE_URL and a migrated database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { bulkApproveMerchantsKyc } from "./bulkKyc.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("bulkKyc.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 4 });

test.after(async () => {
  await pool.end();
});

async function createMerchant(status: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, onboarding_status) VALUES ($1, $2) RETURNING id`,
    [`Bulk KYC ${randomUUID()}`, status],
  );
  return result.rows[0]!.id;
}

test("bulk approve skips merchants that are not under review and records a review", async () => {
  const admin = await pool.query<{ id: string; email: string }>(
    `INSERT INTO admin_users (email, password_hash, display_name, role)
     VALUES ($1, 'unused', 'Bulk Reviewer', 'finance') RETURNING id, email`,
    [`bulk-kyc-${randomUUID()}@admin.test`],
  );
  const adminUserId = admin.rows[0]!.id;
  const email = admin.rows[0]!.email;

  const underReview = await createMerchant("under_review");
  const submitted = await createMerchant("submitted");
  const rejected = await createMerchant("rejected");

  const result = await bulkApproveMerchantsKyc(pool, {
    merchantIds: [submitted, underReview, rejected],
    adminUserId,
    reviewerIdentifier: email,
    notes: "queue",
  });

  assert.deepEqual(result.approvedMerchantIds, [underReview]);
  assert.equal(result.approvedCount, 1);

  const merchants = await pool.query<{ id: string; onboarding_status: string; kyc_passed: boolean }>(
    `SELECT id, onboarding_status, kyc_passed FROM merchants WHERE id = ANY($1::uuid[])`,
    [[underReview, submitted, rejected]],
  );
  const byId = new Map(merchants.rows.map((row) => [row.id, row]));
  assert.equal(byId.get(underReview)?.onboarding_status, "approved");
  assert.equal(byId.get(underReview)?.kyc_passed, true);
  assert.equal(byId.get(submitted)?.onboarding_status, "submitted");
  assert.equal(byId.get(submitted)?.kyc_passed, false);
  assert.equal(byId.get(rejected)?.onboarding_status, "rejected");
  assert.equal(byId.get(rejected)?.kyc_passed, false);

  const reviews = await pool.query<{
    merchant_id: string;
    outcome: string;
    reviewer_identifier: string;
    reviewer_admin_user_id: string;
    notes: string | null;
  }>(
    `SELECT merchant_id, outcome, reviewer_identifier, reviewer_admin_user_id, notes
       FROM merchant_kyc_reviews WHERE merchant_id = ANY($1::uuid[])`,
    [[underReview, submitted, rejected]],
  );
  assert.equal(reviews.rowCount, 1);
  assert.equal(reviews.rows[0]!.merchant_id, underReview);
  assert.equal(reviews.rows[0]!.outcome, "approved");
  assert.equal(reviews.rows[0]!.reviewer_identifier, email);
  assert.equal(reviews.rows[0]!.reviewer_admin_user_id, adminUserId);
  assert.equal(reviews.rows[0]!.notes, "queue");
});
