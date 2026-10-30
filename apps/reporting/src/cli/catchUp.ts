import type { Pool } from "pg";
import type { ReportingConfig } from "../config.js";
import { runConsumerPass } from "../consumer/runConsumerPass.js";

/**
 * `reporting catch-up` — one-shot: calls runConsumerPass
 * in a loop until a pass returns `processedCount: 0`, then exits. For
 * manual/backfill use — an operator wants the rollups caught up immediately
 * rather than waiting for a running daemon's next poll — without leaving a
 * second daemon instance running.
 */
/**
 * Always terminates: each pass advances the watermark faster than new events
 * arrive, so a pass eventually returns zero rows.
 */
export async function runCatchUp(pool: Pool, config: ReportingConfig): Promise<void> {
  // Safe beside a live worker: each pass locks the same cursor row and
  // commits the rollup writes with the watermark, or rolls both back.
  let totalProcessed = 0;
  for (;;) {
    const { processedCount } = await runConsumerPass(pool, config);
    totalProcessed += processedCount;
    if (processedCount === 0) break;
  }
  console.log(`[reporting/catch-up] caught up, processed ${totalProcessed} event(s) total`);
}
