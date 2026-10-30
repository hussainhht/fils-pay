import assert from "node:assert/strict";
import test from "node:test";
import {
  capitalize,
  formatCardBrandHint,
  formatFileSize,
  groupBy,
  isValidEmail,
  pluralize,
  truncateMiddle,
} from "./helpers.js";

test("checkout brand hint follows Visa, Mastercard 51-55 and 2221-2720, and Amex 34/37", () => {
  assert.equal(formatCardBrandHint("4111111111111111"), "visa");
  assert.equal(formatCardBrandHint("4111 1111 1111 1111"), "visa");
  assert.equal(formatCardBrandHint("5100000000000000"), "mastercard");
  assert.equal(formatCardBrandHint("5500000000000004"), "mastercard");
  assert.equal(formatCardBrandHint("2221000000000009"), "mastercard");
  assert.equal(formatCardBrandHint("2720000000000005"), "mastercard");
  assert.equal(formatCardBrandHint("2220999999999999"), "unknown");
  assert.equal(formatCardBrandHint("2721000000000004"), "unknown");
  assert.equal(formatCardBrandHint("378282246310005"), "amex");
  assert.equal(formatCardBrandHint("341111111111111"), "amex");
  assert.equal(formatCardBrandHint("6011111111111117"), "unknown");
});

test("truncateMiddle keeps both ends of an id", () => {
  assert.equal(truncateMiddle("abcdefghij", 20), "abcdefghij");
  assert.equal(truncateMiddle("abcdefghij", 7), "abc…hij");
  assert.equal(truncateMiddle("ab", 1), "ab");
});

test("pluralize uses the singular only for one", () => {
  assert.equal(pluralize(1, "transaction"), "1 transaction");
  assert.equal(pluralize(0, "transaction"), "0 transactions");
  assert.equal(pluralize(2, "batch", "batches"), "2 batches");
});

test("email hint accepts a normal address and rejects spaces", () => {
  assert.equal(isValidEmail("owner@shop.bh"), true);
  assert.equal(isValidEmail("owner @shop.bh"), false);
  assert.equal(isValidEmail("owner@shop"), false);
});

test("groupBy keeps input order inside each bucket", () => {
  const grouped = groupBy(
    [
      { id: "a", status: "paid" },
      { id: "b", status: "open" },
      { id: "c", status: "paid" },
    ],
    (row) => row.status,
  );
  assert.deepEqual(
    grouped.paid?.map((row) => row.id),
    ["a", "c"],
  );
  assert.deepEqual(
    grouped.open?.map((row) => row.id),
    ["b"],
  );
});

test("file size stays in whole bytes until the next unit", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(1023), "1023 B");
  assert.equal(formatFileSize(1024), "1.0 KB");
});

test("capitalize leaves an empty string empty", () => {
  assert.equal(capitalize(""), "");
  assert.equal(capitalize("paid"), "Paid");
});
