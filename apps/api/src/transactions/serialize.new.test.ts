import assert from "node:assert/strict";
import { test } from "node:test";
import { serializeTransaction, type TransactionRow } from "./serialize.js";

function row(amounts: Pick<TransactionRow, "amount_fils" | "captured_fils" | "refunded_fils">): TransactionRow {
  return {
    id: "txn-1",
    merchant_id: "merchant-1",
    status: "captured",
    currency: "BHD",
    reference: "order-1",
    acquirer_reference: "acq-1",
    occurred_at: new Date("2026-09-17T18:00:00.000Z"),
    created_at: new Date("2026-09-17T18:00:00.000Z"),
    ...amounts,
  };
}

test("Postgres numeric strings stay whole fils on the transaction DTO", () => {
  const dto = serializeTransaction(row({ amount_fils: "4750", captured_fils: "4755", refunded_fils: "1" }));
  assert.equal(dto.amountFils, 4750);
  assert.equal(dto.capturedFils, 4755);
  assert.equal(dto.refundedFils, 1);
  assert.equal(Number.isInteger(dto.amountFils), true);
  assert.equal(Number.isInteger(dto.capturedFils), true);
  assert.equal(Number.isInteger(dto.refundedFils), true);
});
