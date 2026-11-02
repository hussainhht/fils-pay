import assert from "node:assert/strict";
import test from "node:test";
import { demoTotp, verifyDemoCode } from "../../ui/demoTotp.js";

test("demo codes match the RFC 6238 SHA-1 vectors truncated to six digits", async () => {
  for (const [seconds, expected] of [[59, "287082"], [1111111109, "081804"], [1111111111, "050471"], [1234567890, "005924"], [2000000000, "279037"], [20000000000, "353130"]] as const) {
    assert.equal(await demoTotp(seconds * 1000), expected);
  }
});

test("demo verification accepts adjacent time steps and rejects wrong or malformed codes", async () => {
  const now = 1234567890 * 1000;
  for (const drift of [-30_000, 0, 30_000]) {
    assert.equal(await verifyDemoCode(await demoTotp(now + drift), now), true);
  }
  assert.equal(await verifyDemoCode(await demoTotp(now - 90_000), now), false);
  for (const invalid of ["", "00592", "0059240", "abcdef", " 005924"]) {
    assert.equal(await verifyDemoCode(invalid, now), false);
  }
});
