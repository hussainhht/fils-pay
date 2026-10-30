import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDelete, buildWhere } from "./sqlFilter.js";

test("an empty id list matches nothing instead of omitting WHERE", () => {
  const where = buildWhere({ id: [] });
  assert.equal(where.clause, "WHERE FALSE");
  assert.deepEqual(where.values, []);

  const del = buildDelete("holds", { id: [] });
  assert.equal(del.text, "DELETE FROM holds WHERE FALSE");
  assert.deepEqual(del.values, []);
});

test("a non-empty id list stays an ANY predicate", () => {
  const ids = ["11111111-1111-1111-1111-111111111111"];
  const del = buildDelete("holds", { id: ids });
  assert.equal(del.text, "DELETE FROM holds WHERE id = ANY($1::uuid[])");
  assert.deepEqual(del.values, [ids]);
});
