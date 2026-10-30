import type { PoolClient } from "pg";

/**
 * Status recompute must not promote a sandbox merchant. `test_mode` changes
 * only through an explicit admin action.
 */
export async function reconcileSandboxFlag(
  _client: PoolClient,
  _merchantId: string,
  _summary: { scanned: number; openAuthorizations: number },
): Promise<string[]> {
  return [];
}
