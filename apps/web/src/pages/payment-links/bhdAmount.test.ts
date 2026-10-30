import assert from "node:assert/strict";
import test from "node:test";
import { isBhdAmountDraft, normalizeBhdAmount, parseBhdAmountDraft } from "./bhdAmount.js";

test("accepts literal decimal placement and intermediate editing states", () => {
  for (const value of ["", ".", "1", "1.", "0.", "1.5", "1.500", "12.500", "1.250", "0.100", "0.001", ".001", "0001.50", "12500"]) {
    assert.equal(isBhdAmountDraft(value), true, value);
  }
});

test("rejects multiple decimals, signs, excess precision and non-decimal text without rounding", () => {
  for (const value of ["1..5", "1.2.3", "-1", "-0", "+1", "1.2345", "0.0001", "1e3", "1,500", "NaN", "Infinity", " 1.500 ", "1\n", "١.٥"]) {
    assert.equal(isBhdAmountDraft(value), false, value);
    assert.equal(parseBhdAmountDraft(value), null, value);
    assert.equal(normalizeBhdAmount(value), value, value);
  }
});

test("normalizes complete drafts to three decimals only when requested", () => {
  for (const [draft, normalized] of [["1", "1.000"], ["1.", "1.000"], ["0.", "0.000"], ["1.5", "1.500"], [".001", "0.001"], ["00012.50", "12.500"], ["12.500", "12.500"]]) {
    assert.equal(normalizeBhdAmount(draft!), normalized);
  }
  assert.equal(normalizeBhdAmount(""), "");
  assert.equal(normalizeBhdAmount("."), ".");
  assert.equal(parseBhdAmountDraft(""), null);
  assert.equal(parseBhdAmountDraft("."), null);
});

test("converts BHD decimal strings to exact integer fils including the third decimal", () => {
  for (const [draft, fils] of [["1", 1000], ["1.", 1000], ["1.5", 1500], ["1.500", 1500], ["12.500", 12500], ["1.250", 1250], ["0.100", 100], ["0.001", 1], [".001", 1], ["0.029", 29], ["1.001", 1001], ["00012.500", 12500], ["0.", 0]] as const) {
    assert.equal(parseBhdAmountDraft(draft), fils, draft);
  }
});

test("keeps the entire safe-integer range exact and refuses overflow", () => {
  assert.equal(parseBhdAmountDraft("9007199254740.991"), Number.MAX_SAFE_INTEGER);
  assert.equal(parseBhdAmountDraft("9007199254740.992"), null);
  assert.equal(parseBhdAmountDraft("99999999999999999999999999999999999"), null);
  assert.equal(normalizeBhdAmount("9007199254740.992"), "9007199254740.992");
});
