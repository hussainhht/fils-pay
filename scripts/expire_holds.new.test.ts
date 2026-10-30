import assert from "node:assert/strict";
import { test } from "node:test";
import { buildExpiredHoldsUpdate } from "./expire_holds.js";

test("an empty id list does not build a write", () => {
  assert.equal(buildExpiredHoldsUpdate([]), null);
});
