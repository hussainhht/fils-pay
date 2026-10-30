import type { Pool } from "pg";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { withTransaction } from "../db/withTransaction.js";
import { NotFoundError } from "../lib/errors.js";
import { recordKycReviewInTx } from "../onboarding/review.js";

export interface BulkApproveMerchantsKycInput {
  merchantIds: string[];
  adminUserId: string;
  reviewerIdentifier: string;
  notes?: string;
}

/**
 * @property approvedMerchantIds Only merchants that moved from under_review to approved.
 * Already-approved or rejected ids are skipped and not listed.
 */
export interface BulkApproveMerchantsKycResult {
  approvedCount: number;
  approvedMerchantIds: string[];
}

/** Approves the given merchants and audits it. */
export async function bulkApproveMerchantsKyc(
  pool: Pool,
  input: BulkApproveMerchantsKycInput,
): Promise<BulkApproveMerchantsKycResult> {
  return withTransaction(pool, async (client) => {
    const admin = await client.query<{ email: string }>(
      `SELECT email FROM admin_users WHERE id = $1`,
      [input.adminUserId],
    );
    if (!admin.rows[0]?.email) {
      throw new NotFoundError("admin_not_found");
    }

    const eligible = await client.query<{ id: string }>(
      `SELECT id
         FROM merchants
        WHERE id = ANY($1::uuid[])
          AND onboarding_status = 'under_review'
        FOR UPDATE`,
      [input.merchantIds],
    );
    const approvedMerchantIds: string[] = [];
    for (const row of eligible.rows) {
      await recordKycReviewInTx(client, {
        merchantId: row.id,
        outcome: "approved",
        reviewerIdentifier: input.reviewerIdentifier,
        reviewerAdminUserId: input.adminUserId,
        notes: input.notes,
      });
      approvedMerchantIds.push(row.id);
    }

    await insertAdminAuditLog(client, {
      adminUserId: input.adminUserId,
      action: "kyc_bulk_approve",
      targetType: "platform",
      targetId: null,
      metadata: {
        requestedMerchantIds: input.merchantIds,
        approvedMerchantIds,
        notes: input.notes ?? null,
      },
    });

    return { approvedCount: approvedMerchantIds.length, approvedMerchantIds };
  });
}
