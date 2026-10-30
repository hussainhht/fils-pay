/**
 * PDF-only KYC types follow magic bytes, not the filename.
 * Requires DATABASE_URL and a migrated database.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { recordKycDocument } from "./kyc.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("kyc.new.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
const kycUploadDir = mkdtempSync(join(tmpdir(), "filspay-kyc-new-"));
const config = { kycUploadDir } as Config;

test.after(async () => {
  await pool.end();
  await rm(kycUploadDir, { recursive: true, force: true });
});

async function createMerchantUser(): Promise<{ merchantId: string; userId: string }> {
  const merchant = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name) VALUES ($1) RETURNING id`,
    [`KYC New ${randomUUID()}`],
  );
  const merchantId = merchant.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO merchant_users (merchant_id, email, role, password_hash)
     VALUES ($1, $2, 'owner', 'unused') RETURNING id`,
    [merchantId, `kyc-${randomUUID()}@example.test`],
  );
  return { merchantId, userId: user.rows[0]!.id };
}

test("a JPEG named .pdf is rejected for a PDF-only document type", async () => {
  const { merchantId, userId } = await createMerchantUser();
  await assert.rejects(
    () =>
      recordKycDocument(pool, config, {
        merchantId,
        documentType: "commercial_registration",
        fileName: "cr.pdf",
        buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
        uploadedBy: userId,
      }),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.statusCode, 422);
      assert.equal(err.code, "document_must_be_pdf");
      return true;
    },
  );
  const docs = await pool.query(`SELECT 1 FROM kyc_documents WHERE merchant_id = $1`, [merchantId]);
  assert.equal(docs.rowCount, 0);
});

test("a PDF named .docx is accepted for a PDF-only document type", async () => {
  const { merchantId, userId } = await createMerchantUser();
  const result = await recordKycDocument(pool, config, {
    merchantId,
    documentType: "bank_letter",
    fileName: "letter.docx",
    buffer: Buffer.from("%PDF-1.4\n%mock\n%%EOF"),
    uploadedBy: userId,
  });
  assert.equal(result.mimeType, "application/pdf");
});
