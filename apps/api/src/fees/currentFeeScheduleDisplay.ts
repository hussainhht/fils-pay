import type { Pool } from "pg";

/**
 * effectiveFrom: when the rate starts applying. createdAt: when it was
 * keyed in. The display returns the latest row whose effectiveFrom is not
 * in the future.
 */
export interface CurrentFeeScheduleDisplay {
  mdrBps: number;
  effectiveFrom: Date;
  createdAt: Date;
}

/**
 * The schedule in force at `asOf` for the admin merchant-detail page.
 * Same rule as getEffectiveMdrBps: effective_from <= asOf, latest
 * effective_from, then latest created_at. Returns null when nothing is
 * in force yet (the page shows merchants.mdr_bps separately).
 */
export async function getCurrentFeeScheduleForDisplay(
  pool: Pool,
  merchantId: string,
  asOf: Date = new Date(),
): Promise<CurrentFeeScheduleDisplay | null> {
  const result = await pool.query<{ mdr_bps: number; effective_from: Date; created_at: Date }>(
    `SELECT mdr_bps, effective_from, created_at
       FROM fee_schedules
      WHERE merchant_id = $1
        AND effective_from <= $2
      ORDER BY effective_from DESC, created_at DESC
      LIMIT 1`,
    [merchantId, asOf],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { mdrBps: row.mdr_bps, effectiveFrom: row.effective_from, createdAt: row.created_at };
}
