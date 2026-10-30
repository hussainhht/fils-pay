import type { QueryableClient } from "@filspay/events";

/**
 * Producer barrier for a reporting pass or rebuild. SHARE conflicts with
 * INSERT/UPDATE/DELETE and waits for writers already in the table, but it
 * does not conflict with plain SELECTs.
 *
 * Outbox ids are allocated before the producer commits. Without this lock a
 * consumer can apply a higher committed id and move the cursor past a lower
 * id that commits afterwards. Holding SHARE until this transaction commits
 * means every lower id has already committed or rolled back, and any insert
 * still waiting receives a higher id only after the cursor is published.
 */
export async function lockOutboxForCommitSafeRead(client: QueryableClient): Promise<void> {
  await client.query(`LOCK TABLE outbox_events IN SHARE MODE`);
}
