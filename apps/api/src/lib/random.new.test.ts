import assert from "node:assert/strict";
import { test } from "node:test";
import { randomDigits, randomFromAlphabet } from "./random.js";
import { createPaymentLink } from "../paymentLinks/create.js";
import type { Pool } from "pg";

test("OTP and payment-link generation do not use Math.random", async () => {
  const previous = Math.random;
  Math.random = () => { throw new Error("Math.random must not generate security tokens"); };
  try {
    assert.match(randomDigits(6), /^\d{6}$/);
    assert.match(randomFromAlphabet("abc", 32), /^[abc]{32}$/);
    let token: unknown;
    const pool = {
      query: async (_sql: string, values: unknown[]) => {
        token = values[1];
        return { rows: [{
          id: "link", merchant_id: values[0], token, amount_fils: values[2],
          reference: null, description: null, status: "active", expires_at: values[5],
          created_at: new Date(), paid_at: null, paid_transaction_id: null,
        }] };
      },
    } as unknown as Pool;
    await createPaymentLink(pool, { checkoutBaseUrl: "https://checkout.example.test" }, {
      merchantId: "merchant", amountFils: 1000, expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdByType: "merchant_session", createdById: "user",
    });
    assert.match(String(token), /^plink_[A-Za-z0-9_-]{22}$/);
  } finally {
    Math.random = previous;
  }
});

test("random helpers reject invalid lengths and empty alphabets", () => {
  for (const length of [-1, 0.5, NaN, Infinity]) assert.throws(() => randomDigits(length), RangeError);
  assert.throws(() => randomFromAlphabet("", 6), RangeError);
  assert.equal(randomDigits(0), "");
});
