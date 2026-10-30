import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcileSandboxFlag } from "./merchantFlags.js";

test("status recompute does not clear test_mode", async () => {
  const client = {
    query(): never {
      throw new Error("must not read or write merchants");
    },
  };
  const flags = await reconcileSandboxFlag(client as never, "merchant", {
    scanned: 4,
    openAuthorizations: 0,
  });
  assert.deepEqual(flags, []);
});
