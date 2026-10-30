import type { Pool } from "pg";
import { enqueueEvent } from "@filspay/events";
import { withTransaction } from "../db/withTransaction.js";

/** Expiry is derived, not a stored state. Lock the link while recording its
 * notification so concurrent scanners cannot publish the same expiry twice.
 * Reserved links can still finish a payment and must not be called expired. */
export async function enqueueExpiredPaymentLinks(pool: Pool): Promise<void> {
  await withTransaction(pool, async client => {
    // Serialize scanners before taking the SELECT snapshot. Row locks alone
    // do not change the link tuple, so a snapshot taken before another
    // scanner's commit could otherwise miss its newly inserted event.
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('filspay.payment_link.expiry'), 0) AS acquired",
    );
    if (!lock.rows[0]!.acquired) return;
    const links = await client.query<{ id: string; merchant_id: string; amount_fils: string; expires_at: Date }>(`
      SELECT pl.id, pl.merchant_id, pl.amount_fils, pl.expires_at
        FROM payment_links pl
       WHERE pl.status = 'active' AND pl.expires_at <= now()
         AND NOT EXISTS (SELECT 1 FROM outbox_events oe
           WHERE oe.event_type = 'payment_link.expired' AND oe.aggregate_id = pl.id)
       ORDER BY pl.expires_at, pl.id LIMIT 500 FOR UPDATE OF pl SKIP LOCKED`);
    for (const link of links.rows) {
      await enqueueEvent(client, {
        eventType: "payment_link.expired", aggregateType: "payment_link", aggregateId: link.id,
        payload: { merchantId: link.merchant_id, paymentLinkId: link.id,
          amountFils: Number(link.amount_fils), expiredAt: link.expires_at.toISOString() },
      });
    }
  });
}
