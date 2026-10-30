import assert from "node:assert/strict";
import { test } from "node:test";
import { adminAccountKey, merchantAccountKey } from "./loginLimits.js";

test("merchant login bucket ignores email case and surrounding space", () => {
  assert.equal(merchantAccountKey("m-1", " Owner@Shop.BH "), "m-1:owner@shop.bh");
});

test("admin login bucket ignores email case and surrounding space", () => {
  assert.equal(adminAccountKey(" Admin@Fils.BH "), "admin@fils.bh");
});

test("two merchants with the same email do not share a login bucket", () => {
  assert.notEqual(merchantAccountKey("m-1", "owner@shop.bh"), merchantAccountKey("m-2", "owner@shop.bh"));
});
