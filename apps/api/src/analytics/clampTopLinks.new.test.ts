import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTopLinksLimit } from "./query.js";

test("top-links limit stays inside 1..50 and garbage falls back to 10", () => {
  assert.equal(clampTopLinksLimit(undefined), 10);
  assert.equal(clampTopLinksLimit(Number.NaN), 10);
  assert.equal(clampTopLinksLimit(Number.POSITIVE_INFINITY), 10);
  assert.equal(clampTopLinksLimit(0), 1);
  assert.equal(clampTopLinksLimit(-4), 1);
  assert.equal(clampTopLinksLimit(3.9), 3);
  assert.equal(clampTopLinksLimit(50), 50);
  assert.equal(clampTopLinksLimit(51), 50);
});
