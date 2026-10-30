import type { PoolClient } from "pg";
import { advanceCursor, readCursor } from "./cursor.js";
import { applyEvent, type OutboxEventRow } from "./applyEvent.js";
import { CONSUMER_NAME, REPORTING_EVENT_TYPES } from "./runConsumerPass.js";
import { lockOutboxForCommitSafeRead } from "./serialization.js";

export interface ReplaySummary {
  volumeRows: number;
  trendRows: number;
  replayed: number;
}

/**
 * Republishes merchant_daily_volume and merchant_payout_trends from the
 * same outbox events the live consumer applies, inside the caller's
 * transaction.
 *
 * Lock order matches runConsumerPass: outbox SHARE, then the cursor row
 * FOR UPDATE. The id horizon is read only after that barrier. It is not an
 * arbitrary MAX(id) taken while producers can still commit a lower id.
 * Every reporting event at or below the horizon is applied before the
 * cursor moves, and a failure rolls the truncate back with the cursor.
 */
export async function rebuildRollupsFromOutbox(client: PoolClient): Promise<ReplaySummary> {
  await lockOutboxForCommitSafeRead(client);
  await readCursor(client, CONSUMER_NAME);

  const horizonResult = await client.query<{ max_id: string | null }>(
    `SELECT MAX(id)::text AS max_id FROM outbox_events`,
  );
  const horizon = horizonResult.rows[0]?.max_id ? BigInt(horizonResult.rows[0].max_id) : 0n;

  await client.query(`TRUNCATE merchant_daily_volume`);
  await client.query(`TRUNCATE merchant_payout_trends`);

  const eventsResult = await client.query<OutboxEventRow>(
    `SELECT id, event_type, aggregate_id, payload, created_at
       FROM outbox_events
      WHERE id <= $1
        AND event_type = ANY($2::text[])
      ORDER BY id ASC`,
    [horizon.toString(), REPORTING_EVENT_TYPES],
  );

  for (const row of eventsResult.rows) {
    await applyEvent(client, row);
  }

  await advanceCursor(client, CONSUMER_NAME, horizon);

  const [volumeResult, trendResult] = await Promise.all([
    client.query<{ count: string }>(`SELECT count(*)::text AS count FROM merchant_daily_volume`),
    client.query<{ count: string }>(`SELECT count(*)::text AS count FROM merchant_payout_trends`),
  ]);

  return {
    volumeRows: Number(volumeResult.rows[0]?.count ?? 0),
    trendRows: Number(trendResult.rows[0]?.count ?? 0),
    replayed: eventsResult.rows.length,
  };
}
