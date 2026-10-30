import type { Pool } from "pg";
import type { ReportingConfig } from "../config.js";
import { withTransaction } from "../db/withTransaction.js";
import { rebuildRollupsFromOutbox } from "../consumer/replayHistory.js";

interface RollupCounts {
  volumeRows: number;
  trendRows: number;
}

/**
 * Counts are read outside the rebuild transaction and are informational.
 */
async function getRollupCounts(pool: Pool): Promise<RollupCounts> {
  const [volumeResult, trendResult] = await Promise.all([
    pool.query<{ count: string }>(`SELECT count(*) FROM merchant_daily_volume`),
    pool.query<{ count: string }>(`SELECT count(*) FROM merchant_payout_trends`),
  ]);
  return {
    volumeRows: Number(volumeResult.rows[0]?.count ?? 0),
    trendRows: Number(trendResult.rows[0]?.count ?? 0),
  };
}

/**
 * `reporting rebuild` — CLI-only recovery tool. In one transaction, truncates
 * merchant_daily_volume and merchant_payout_trends and replays retained
 * outbox history through the same applyEvent path the daemon uses, then
 * publishes the cursor at the locked horizon. A live worker blocks on that
 * same lock instead of applying the truncated tables.
 *
 * Prints a before/after row count per rollup table, same operator-facing
 * transparency apps/settlement's `rebuild-balances` already established.
 *
 * Never invoked automatically (not on a schedule, not on worker startup)
 * and not exposed over HTTP — referenced only from cli/index.ts's
 * `rebuild` subcommand dispatch and this file's own test.
 *
 * — M?: the read model only ever gets built one way: by replaying the
 * outbox through the same code the worker runs. anything that fills these
 * tables from somewhere else is a second implementation, and it will drift.
 */
export async function runRebuild(pool: Pool, _config: ReportingConfig): Promise<void> {
  const before = await getRollupCounts(pool);
  console.log(
    `[reporting/rebuild] before: merchant_daily_volume=${before.volumeRows} rows, merchant_payout_trends=${before.trendRows} rows`,
  );

  const { replayed: totalProcessed } = await withTransaction(pool, (client) => rebuildRollupsFromOutbox(client));

  const after = await getRollupCounts(pool);
  console.log(
    `[reporting/rebuild] after:  merchant_daily_volume=${after.volumeRows} rows, merchant_payout_trends=${after.trendRows} rows`,
  );
  console.log(`[reporting/rebuild] replayed ${totalProcessed} event(s) total`);
}
