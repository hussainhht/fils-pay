import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpiredHoldsUpdate } from "./expire_holds.js";

test("the update is scoped to exactly the ids it was handed", () => {
  const ids = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"];
  const statement = buildExpiredHoldsUpdate(ids);
  assert.ok(statement);
  assert.equal(statement.text, "UPDATE holds SET status = 'expired' WHERE id = ANY($1::uuid[])");
  assert.deepEqual(statement.values, [ids]);
});

test("a single id still goes through the array predicate rather than a bare equality", () => {
  const statement = buildExpiredHoldsUpdate(["33333333-3333-3333-3333-333333333333"]);
  assert.ok(statement);
  assert.equal(statement.text, "UPDATE holds SET status = 'expired' WHERE id = ANY($1::uuid[])");
  assert.equal((statement.values[0] as string[]).length, 1);
});

