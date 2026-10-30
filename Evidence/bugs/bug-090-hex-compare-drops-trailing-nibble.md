# BUG-090 — Hex Compare Treats a Trailing Nibble as Equal

**Fixed (2026-10-30):** `timingSafeEqualHex` requires both strings to be the same even-length hex before it decodes them. Covered by `apps/api/src/lib/crypto.new.test.ts`.

## 1. Summary

`timingSafeEqualHex` decodes with `Buffer.from(value, "hex")`. Node drops a trailing nibble, so a digest and that digest plus one extra hex character compare equal.

## 2. Classification

- Severity: Medium
- Confidence: High
- Verification Status: RUNTIME REPRODUCED
- Category: Webhooks
- Affected Component: apps/api/src/lib/crypto.ts
- Reachability: `verifySignature` compares the `v1` value from the `Webhook-Signature` header. OTP verification hashes the submitted code itself, so a caller cannot append a nibble to that comparison.
- Original Contributors / Sources: New tests outside the existing registry, 2026-10-30

## 3. Root Cause

The length check runs on the decoded buffers. An odd-length hex string decodes to the same bytes as the string with its last character removed, so the buffers have equal length and equal contents.

## 4. Affected Files and Functions

- `apps/api/src/lib/crypto.ts` — `timingSafeEqualHex`
- `apps/api/src/webhooks/sign.ts` — `verifySignature` passes the header's `v1` value here

## 5. Expected Behavior

A digest compares equal only to the same even-length hex. One extra character, an odd length, or a non-hex character is a mismatch.

## 6. Actual Behavior

`timingSafeEqualHex(digest, digest + "0")` returned true. `timingSafeEqualHex("ab", "abc")` returned true.

## 7. Trigger Conditions

Webhook verification of a `v1` signature that is a valid digest with one extra hex character appended.

## 8. Technical Evidence

```ts
const bufA = Buffer.from(a, "hex");
const bufB = Buffer.from(b, "hex");
if (bufA.length !== bufB.length) return false;
return timingSafeEqual(bufA, bufB);
```

`Buffer.from("abc", "hex")` is the same byte as `Buffer.from("ab", "hex")`.

## 9. Runtime Evidence

`apps/api/src/lib/crypto.new.test.ts` failed before the fix: expected false, actual true, for a SHA-256 hex digest with `0` appended.

## 10. Security / Financial / Functional Impact

Someone who already has a valid webhook signature can append one hex character and still pass `verifySignature`. They do not learn a new signature. A shorter digest was already rejected because the decoded lengths differ.

## 11. Safe Reproduction

Compare `sha256Hex("filspay")` with that same string plus `"0"` through `timingSafeEqualHex`. No webhook delivery is required.

## 12. Related Findings

[BUG-045](bug-045-webhook-signature-mismatch.md) is the outbound signature covering a different byte string than the body. [BUG-046](bug-046-inbound-callback-hmac-reserialized.md) is the acquirer callback verifier. This bug is the shared hex compare those checks were meant to use.

## 13. Documentation Contradictions

The comment says the compare is constant-time over two hex digests. It does not require the strings to be well-formed hex.

## 14. Recommended Remediation

Return false unless both strings are the same length and match an even number of hex digits, then decode and compare.

## 15. Remaining Questions and Limitations

The early length and charset checks are not constant-time. The decoded-buffer compare still is. A wrong signature of a different length was already rejected before the MAC compare.

## 16. Original Reports Merged

None.

## 17. Evidence References

`apps/api/src/lib/crypto.ts`, `apps/api/src/webhooks/sign.ts`, `apps/api/src/lib/crypto.new.test.ts`.
