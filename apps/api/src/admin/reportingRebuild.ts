import type { PoolClient } from "pg";
import { rebuildRollupsFromOutbox } from "../../../reporting/src/consumer/replayHistory.js";

/** Counts of outbox events replayed into each rollup table. */
export interface RebuildAnalyticsSummary {
  volumeRows: number;
  trendRows: number;
}

/**
 * Truncates and repopulates merchant_daily_volume and merchant_payout_trends
 * from the reporting outbox, and moves reporting_outbox_cursor to the same
 * locked horizon. Caller supplies the transaction (admin audit included).
 */
export async function refreshAnalyticsRollups(client: PoolClient): Promise<RebuildAnalyticsSummary> {
  const result = await rebuildRollupsFromOutbox(client);
  return { volumeRows: result.volumeRows, trendRows: result.trendRows };
}
