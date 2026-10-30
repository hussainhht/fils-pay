import assert from "node:assert/strict";
import { test } from "node:test";
import { safeParseCookieValue } from "./cookies.js";

test("cookie values decode and a broken escape is rejected", () => {
  assert.equal(safeParseCookieValue(undefined), null);
  assert.equal(safeParseCookieValue(""), null);
  assert.equal(safeParseCookieValue("a%20b"), "a b");
  assert.equal(safeParseCookieValue("%"), null);
  assert.equal(safeParseCookieValue("%ZZ"), null);
});
