import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { compareFils, parseBhdToFils, subtractFils, toFils } from "@filspay/money";
import { withTransaction } from "../db/withTransaction.js";
import { calculateDiscountedMdrFee } from "../v1/fees/calculateFee.js";
import { BadRequestError } from "../lib/errors.js";


/**
 * Parses a promotional discount amount (BD string from the merchant
 * pricing dashboard) into fils for the ledger adjustment.
 */
export function parsePromotionalDiscountFils(raw: string): number {
  let fils;
  try {
    fils = parseBhdToFils(raw);
  } catch (err) {
    throw new BadRequestError(
      "invalid_discount",
      err instanceof Error ? err.message : `could not parse discount amount "${raw}"`,
    );
  }
  if (fils < 0) {
    throw new BadRequestError("invalid_discount", `could not parse discount amount "${raw}"`);
  }
  return fils;
}

/**
 * Each capture event is adjusted at most once, including a zero rebate.
 * New captures already journal discount-then-MDR (`feeModel`), so this
 * posts nothing for them. An older event that stored the full MDR fee is
 * rebated down to that same fee, once, and only for the caller's merchant.
 */
export async function applyCaptureDiscountAdjustment(
  pool: Pool,
  input: { merchantId: string; transactionId: string },
): Promise<void> {
  return withTransaction(pool, async (client) => {
    const merchantRow = await client.query<{ negotiated_discount_bps: number; mdr_bps: number }>(
      `SELECT negotiated_discount_bps, mdr_bps FROM merchants WHERE id = $1`,
      [input.merchantId],
    );
    const discountBps = merchantRow.rows[0]?.negotiated_discount_bps ?? 0;
    if (discountBps === 0) return;
    const mdrBps = merchantRow.rows[0]?.mdr_bps ?? 0;

    const owned = await client.query(
      `SELECT id FROM transactions WHERE id = $1 AND merchant_id = $2 FOR UPDATE`,
      [input.transactionId, input.merchantId],
    );
    if (!owned.rows[0]) return;

    for (;;) {
      const eventRow = await client.query<{
        id: string;
        amount_fils: string | null;
        metadata: { feeFils?: number; feeModel?: string };
      }>(
        `SELECT te.id, te.amount_fils, te.metadata
           FROM transaction_events te
           JOIN transactions t ON t.id = te.transaction_id AND t.merchant_id = $2
          WHERE te.transaction_id = $1
            AND te.event_type IN ('captured', 'partially_captured')
            AND COALESCE(te.metadata->>'discountAdjusted', '') <> 'true'
          ORDER BY te.occurred_at, te.id
          LIMIT 1
          FOR UPDATE OF te`,
        [input.transactionId, input.merchantId],
      );
      const event = eventRow.rows[0];
      if (!event) return;

      const charged = toFils(Number(event.metadata?.feeFils ?? 0));
      const alreadyNet = event.metadata?.feeModel === "discounted_amount";
      const target = calculateDiscountedMdrFee(toFils(Number(event.amount_fils ?? 0)), mdrBps, discountBps);
      const rebate = alreadyNet || compareFils(charged, target) <= 0 ? toFils(0) : subtractFils(charged, target);
      if (rebate > 0) {
        const entryGroupId = randomUUID();
        await client.query(
          `INSERT INTO ledger_entries
             (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
           VALUES
             ($1, $2, $3, 'platform_fee_revenue', 'debit',  $4, now(), 'capture: negotiated discount adjustment'),
             ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: negotiated discount adjustment')`,
          [entryGroupId, input.merchantId, input.transactionId, rebate],
        );
      }
      await client.query(
        `UPDATE transaction_events
            SET metadata = metadata || jsonb_build_object('discountAdjusted', true)
          WHERE id = $1`,
        [event.id],
      );
    }
  });
}
