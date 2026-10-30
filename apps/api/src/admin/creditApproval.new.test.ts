import assert from "node:assert/strict";
import { test } from "node:test";
import { assertDistinctApprover } from "./creditApproval.js";
import { AppError } from "../lib/errors.js";

test("two admins who share a display name can approve each other's credits", () => {
  assert.doesNotThrow(() =>
    assertDistinctApprover(
      { adminUserId: "11111111-1111-4111-8111-111111111111", displayName: "Fatima" },
      { adminUserId: "22222222-2222-4222-8222-222222222222", displayName: "Fatima" },
    ),
  );
});

test("one admin cannot self-approve by using a different display name", () => {
  const adminUserId = "11111111-1111-4111-8111-111111111111";
  assert.throws(
    () =>
      assertDistinctApprover(
        { adminUserId, displayName: "Fatima" },
        { adminUserId, displayName: "F. Al-Khalifa" },
      ),
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "self_approval_forbidden");
      return true;
    },
  );
});
