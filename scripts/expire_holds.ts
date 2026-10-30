#!/usr/bin/env -S npx tsx
/**
 * Nightly janitor: a hold that's never captured or released stays 'active'
 * past expires_at. This marks those rows 'expired'. It does not delete holds.
 *
 * Usage: DATABASE_URL=postgres://... npx tsx scripts/expire_holds.ts
 */
import { pathToFileURL } from "node:url";
import { Client } from "pg";

/** Holds that outlived their authorization window without being captured
 *  or released — the candidate set for tonight's cleanup. */
export async function fetchExpiredHoldIds(client: Client): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM holds WHERE status = 'active' AND expires_at < now()`,
  );
  return result.rows.map((r) => r.id);
}

/** Marks the given holds expired. An empty id list is a no-op (no statement). */
export function buildExpiredHoldsUpdate(
  expiredIds: string[],
): { text: string; values: unknown[] } | null {
  if (expiredIds.length === 0) return null;
  return {
    text: "UPDATE holds SET status = 'expired' WHERE id = ANY($1::uuid[])",
    values: [expiredIds],
  };
}

/**
 * Marks holds that are still 'active' and past expires_at as 'expired'.
 * Rows are not deleted. A night with nothing expired runs no write.
 */
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("expire_holds: DATABASE_URL environment variable is not set");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const expiredIds = await fetchExpiredHoldIds(client);
    const statement = buildExpiredHoldsUpdate(expiredIds);
    if (!statement) {
      console.log("expire_holds: matched 0 abandoned hold(s), updated 0 row(s)");
    } else {
      const result = await client.query(statement.text, statement.values);
      console.log(
        `expire_holds: matched ${expiredIds.length} abandoned hold(s), updated ${result.rowCount ?? 0} row(s)`,
      );
    }
  } finally {
    await client.end();
  }
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
