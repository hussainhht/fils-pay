import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCheckoutUrl, serializePaymentLink, type PaymentLinkRow } from "./serialize.js";

test("checkout url keeps the token verbatim", () => {
  assert.equal(
    buildCheckoutUrl("https://pay.filspay.test", "plink_abc-DEF_012"),
    "https://pay.filspay.test/pay/plink_abc-DEF_012",
  );
});

test("payment-link amount strings stay whole fils", () => {
  const row: PaymentLinkRow = {
    id: "link-1",
    merchant_id: "merchant-1",
    token: "plink_abc",
    amount_fils: "4750",
    currency: "BHD",
    reference: null,
    description: null,
    status: "active",
    expires_at: new Date("2026-10-01T21:00:00.000Z"),
    reserved_at: null,
    transaction_id: null,
    created_by_type: "merchant_session",
    created_by_id: "user-1",
    created_at: new Date("2026-09-17T18:00:00.000Z"),
    paid_at: null,
    canceled_at: null,
  };
  const dto = serializePaymentLink(row, "https://pay.filspay.test");
  assert.equal(dto.amountFils, 4750);
  assert.equal(Number.isInteger(dto.amountFils), true);
  assert.equal(dto.url, "https://pay.filspay.test/pay/plink_abc");
});
