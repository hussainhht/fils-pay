import assert from "node:assert/strict";
import { test } from "node:test";
import { toFils } from "@filspay/money";
import { createDemoCheckoutAcquirer } from "./demo.js";

test("demo adapter has stable references across restarts and refuses non-demo captures", async () => {
  const request = { merchantId: "test", amountFils: toFils(4750), currency: "BHD" as const,
    card: { pan: "4000000000000002", expiryMonth: 12, expiryYear: 2030, cvv: "123" }, idempotencyKey: "operation" };
  const result = await createDemoCheckoutAcquirer().authorize(request);
  assert.equal(result.outcome, "approved");
  assert.deepEqual(await createDemoCheckoutAcquirer().authorize(request), result);
  await assert.rejects(createDemoCheckoutAcquirer().capture({ acquirerReference: "acq_live", amountFils: toFils(4750), idempotencyKey: "capture" }));
});
