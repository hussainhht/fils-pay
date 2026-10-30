import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("scope.test.ts requires DATABASE_URL");
}

const pool = new Pool({ connectionString: databaseUrl, max: 2 });

after(async () => {
  await pool.end();
});

async function createMerchant(label: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO merchants (display_name, mdr_bps) VALUES ($1, 250) RETURNING id`,
    [`Scope ${label} ${randomUUID()}`],
  );
  return result.rows[0]!.id;
}

test("a parent may report on its own split child and not on another parent's child", async () => {
  const parentA = await createMerchant("parent-a");
  const parentB = await createMerchant("parent-b");
  const childA = await createMerchant("child-a");
  const childB = await createMerchant("child-b");
  await pool.query(
    `INSERT INTO merchant_split_children (parent_merchant_id, child_merchant_id, split_weight_bps)
     VALUES ($1, $2, 5000), ($3, $4, 5000)`,
    [parentA, childA, parentB, childB],
  );

  assert.equal(await resolveReportMerchantId(pool, parentA, childA), childA);
  assert.equal(await resolveReportMerchantId(pool, parentA, childB), parentA);
  assert.equal(await resolveReportMerchantId(pool, parentA, randomUUID()), parentA);
  assert.equal(await resolveReportMerchantId(pool, parentA), parentA);
});
