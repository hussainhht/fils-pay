import assert from "node:assert/strict";
import test from "node:test";
import { deleteBesideSeparator, detectCardBrand, digitsOnly, formatCardNumber, formatEdit, formatExpiry, linkHasExpired, passesLuhn, toCardInput, validateCard } from "./cardInput.js";

const now = new Date(2026, 9, 30);
const valid = { number: "4242 4242 4242 4242", expiry: "12/30", securityCode: "123" };

test("Visa detection and grouping; all supported Visa lengths pass", () => {
  assert.equal(detectCardBrand("4"), "visa");
  assert.equal(formatCardNumber("4242424242424242"), valid.number);
  for (const number of ["4222222222222", "4242424242424242", "4000000000000000006"]) {
    assert.equal(validateCard({ ...valid, number }, now).number, undefined);
  }
  assert.equal(passesLuhn("4242424242424241"), false);
  assert.ok(validateCard({ ...valid, number: "4242424242424241" }, now).number);
});

test("Mastercard detects 51–55 and both boundaries of the 2-series IIN range", () => {
  for (const prefix of ["51", "55", "2221", "2229", "2230", "2300", "2699", "2700", "2720"]) {
    assert.equal(detectCardBrand(prefix), "mastercard");
  }
  for (const prefix of ["50", "56", "2220", "2721", "222", "27"]) assert.equal(detectCardBrand(prefix), "unknown");
  assert.equal(formatCardNumber("2221000000000009"), "2221 0000 0000 0009");
  assert.deepEqual(validateCard({ ...valid, number: "2221000000000009" }, now), {});
});

test("Amex uses 15 digits, 4-6-5 grouping, and a four-digit security code", () => {
  for (const prefix of ["34", "37"]) assert.equal(detectCardBrand(prefix), "amex");
  assert.equal(formatCardNumber("378282246310005"), "3782 822463 10005");
  assert.deepEqual(validateCard({ number: "3782 822463 10005", expiry: "12/30", securityCode: "1234" }, now), {});
  assert.ok(validateCard({ ...valid, number: "378282246310005" }, now).securityCode);
  assert.ok(validateCard({ ...valid, number: "3782822463100050" }, now).number);
});

test("unknown networks get a generic hint; a number is never authorized by its prefix", () => {
  assert.equal(detectCardBrand(""), "unknown");
  assert.equal(detectCardBrand("6011 1111 1111 1117"), "unknown");
  assert.deepEqual(validateCard({ ...valid, number: "6011111111111117" }, now), {});
  for (const number of ["", "0000000000000000", "9999999999999999", "4242", "42424242424242424242"]) {
    assert.ok(validateCard({ ...valid, number }, now).number);
  }
});

test("paste strips separators and nonnumeric input without silently truncating a PAN", () => {
  for (const value of ["4242424242424242", "4242 4242-4242 4242", "abc4242.4242/4242 4242"]) {
    assert.equal(formatCardNumber(value), valid.number);
  }
  assert.equal(digitsOnly(formatCardNumber("4".repeat(20))).length, 20);
  assert.deepEqual(toCardInput(valid), { pan: "4242424242424242", expiryMonth: 12, expiryYear: 2030, cvv: "123" });
});

test("formatting preserves caret and selection by digit position during middle edits", () => {
  assert.deepEqual(formatEdit("42429 4242 4242 4242", 5, 5, formatCardNumber), { value: "4242 9424 2424 2424 2", start: 6, end: 6 });
  const selection = formatEdit("378282246310005", 4, 10, formatCardNumber);
  assert.deepEqual(selection, { value: "3782 822463 10005", start: 4, end: 11 });
  assert.equal(formatEdit("4242a", 5, 5, formatCardNumber).start, 4);
  assert.deepEqual(formatEdit("", 0, 0, formatCardNumber), { value: "", start: 0, end: 0 });
});

test("backspace and delete beside generated spaces/slashes remove the adjacent digit", () => {
  assert.deepEqual(deleteBesideSeparator(valid.number, 5, 5, "Backspace", formatCardNumber), { value: "4244 2424 2424 242", start: 3, end: 3 });
  assert.deepEqual(deleteBesideSeparator(valid.number, 4, 4, "Delete", formatCardNumber), { value: "4242 2424 2424 242", start: 4, end: 4 });
  assert.deepEqual(deleteBesideSeparator("12/30", 3, 3, "Backspace", formatExpiry), { value: "13/0", start: 1, end: 1 });
  assert.equal(deleteBesideSeparator(valid.number, 4, 8, "Backspace", formatCardNumber), null);
});

test("expiry typing and paste support MM/YY and MM/YYYY without guessing a month", () => {
  for (const value of ["1230", "12/30", "12/2030", "122030"]) assert.equal(formatExpiry(value), "12/30");
  assert.equal(formatExpiry("1"), "1");
  assert.equal(formatExpiry("12"), "12");
  assert.equal(formatExpiry("123"), "12/3");
  assert.equal(formatExpiry("12299"), "12/299");
});

test("expired cards and invalid months fail; current month is valid through its last day", () => {
  for (const expiry of ["09/26", "12/25", "00/30", "13/30", "1/30", "12/2030", ""]) assert.ok(validateCard({ ...valid, expiry }, now).expiry);
  assert.equal(validateCard({ ...valid, expiry: "10/26" }, now).expiry, undefined);
  assert.ok(validateCard({ ...valid, expiry: "10/26" }, new Date(2026, 10, 1)).expiry);
});

test("security code validates exact network length and numeric characters", () => {
  for (const securityCode of ["", "12", "1234", "abc"]) assert.ok(validateCard({ ...valid, securityCode }, now).securityCode);
  assert.equal(validateCard(valid, now).securityCode, undefined);
  assert.equal(digitsOnly("12a3"), "123");
});

test("existing simulator approval, decline and error test cards remain usable", () => {
  for (const number of ["4242424242424242", "4000000000000002", "4000000000000119", "4000000000000069"]) {
    assert.deepEqual(validateCard({ ...valid, number }, now), {});
  }
});

test("open payment links expire at the deadline; malformed deadlines fail closed", () => {
  const deadline = "2026-10-30T12:00:00.000Z";
  const instant = Date.parse(deadline);
  assert.equal(linkHasExpired(deadline, instant - 1), false);
  assert.equal(linkHasExpired(deadline, instant), true);
  assert.equal(linkHasExpired(deadline, instant + 1), true);
  assert.equal(linkHasExpired("invalid", instant), true);
});
