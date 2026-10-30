import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBhdToFils } from "@filspay/money";
import { parsePromotionalDiscountFils } from "./discountAdjustment.js";

/** 1 BD = 1000 fils. Text amounts go through the same parser as every other BD field. */

test("a promotional discount in BD is an integer number of fils", () => {
  assert.equal(parsePromotionalDiscountFils("4.750"), 4750);
  assert.equal(parsePromotionalDiscountFils("4.75"), 4750);
  assert.equal(parsePromotionalDiscountFils("4.755"), 4755);
  assert.equal(parsePromotionalDiscountFils("0.001"), 1);
  assert.equal(parsePromotionalDiscountFils("1"), 1000);
});

test("promotional discount parsing matches parseBhdToFils", () => {
  for (const raw of ["0", "0.5", "4.75", "4.750", "4.755", "10.001"]) {
    assert.equal(parsePromotionalDiscountFils(raw), Number(parseBhdToFils(raw)));
  }
});

test("promotional discount rejects extra decimals, negatives, and junk", () => {
  assert.throws(() => parsePromotionalDiscountFils("4.7555"));
  assert.throws(() => parsePromotionalDiscountFils("-1"));
  assert.throws(() => parsePromotionalDiscountFils("abc"));
});
