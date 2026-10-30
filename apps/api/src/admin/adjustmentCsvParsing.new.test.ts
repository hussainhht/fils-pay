import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAdjustmentAmountFils } from "./adjustmentCsvParsing.js";

test("4.75 BD is 4750 fils", () => {
  assert.equal(parseAdjustmentAmountFils("4.75"), 4750);
});

test("4.750 BD is 4750 fils", () => {
  assert.equal(parseAdjustmentAmountFils("4.750"), 4750);
});

test("a negative BHD amount keeps its sign in fils", () => {
  assert.equal(parseAdjustmentAmountFils("-1.250"), -1250);
});

test("4.755 BD keeps the third decimal as 4755 fils", () => {
  assert.equal(parseAdjustmentAmountFils("4.755"), 4755);
});

test("more than three fractional digits is rejected", () => {
  assert.throws(() => parseAdjustmentAmountFils("4.7555"), /could not parse amount/);
});
