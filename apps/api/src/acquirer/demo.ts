import { createHash } from "node:crypto";
import type { AcquirerSimulator } from "./types.js";

/** Checkout-only adapter. No money, ledger or state changes belong here.
 * References are stable across retries, restarts and API replicas. */
export function createDemoCheckoutAcquirer(): AcquirerSimulator {
  return {
    async authorize(request) {
      const digest = createHash("sha256").update(`${request.merchantId}:${request.idempotencyKey}`).digest("hex");
      return { outcome: "approved", acquirerReference: `demo_${digest.slice(0, 32)}`, latencyMs: 0 };
    },
    async capture(request) {
      if (!request.acquirerReference.startsWith("demo_")) throw new Error("Demo capture requires a demo authorization");
      return { outcome: "approved", acquirerReference: request.acquirerReference, latencyMs: 0 };
    },
    async refund() { throw new Error("Demo checkout adapter does not handle refunds"); },
  };
}
