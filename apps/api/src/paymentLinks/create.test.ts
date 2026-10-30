import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { BadRequestError } from "../lib/errors.js";
import { createPaymentLink } from "./create.js";

test("creation rejects short expiration and zero amount before writing to PostgreSQL", async (t) => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const pool = { query: async () => { throw new Error("Invalid creation reached INSERT"); } } as unknown as Pool;
  const input = { merchantId: "merchant", amountFils: 1000, createdByType: "merchant_session" as const, createdById: "actor" };
  for (const extra of [
    { expiresAt: new Date(now + 899000).toISOString() },
    { expiresAt: new Date(now + 121 * 86400000).toISOString() },
    { expiresInSeconds: 899 },
    { expiresInSeconds: 900, expiresAt: new Date(now + 86400000).toISOString() },
    { expiresInSeconds: 900, amountFils: 0 },
    { expiresInSeconds: 900, reference: {} as string },
  ]) {
    await assert.rejects(createPaymentLink(pool, { checkoutBaseUrl: "https://example.test" }, { ...input, ...extra }), BadRequestError);
  }
});
