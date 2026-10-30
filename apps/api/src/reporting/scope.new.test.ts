import assert from "node:assert/strict";
import { test } from "node:test";
import type { Pool } from "pg";
import { resolveReportMerchantId } from "./scope.js";

test("report scope only accepts a child of the caller", async () => {
  const pool = { query: async (sql: string, params: string[]) => { assert.ok(sql.includes("parent_merchant_id = $2")); return { rows: params[0] === "child" && params[1] === "parent" ? [{ ok: 1 }] : [] }; } } as unknown as Pool;
  assert.equal(await resolveReportMerchantId(pool, "parent", "child"), "child");
  assert.equal(await resolveReportMerchantId(pool, "foreign", "child"), "foreign");
  assert.equal(await resolveReportMerchantId(pool, "parent"), "parent");
});

