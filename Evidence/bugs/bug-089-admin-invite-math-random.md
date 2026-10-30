# BUG-089 — Admin Invite Codes Are Drawn from Math.random

**Fixed (2026-10-30):** `generateInviteCode` uses `randomFromAlphabet`, which calls `crypto.randomInt`. Covered by `apps/api/src/admin/inviteCode.new.test.ts`.

## 1. Summary

Admin invite codes are built with `Math.random`. That generator is not suitable for a secret a person can redeem.

## 2. Classification

- Severity: Medium
- Confidence: High
- Verification Status: RUNTIME REPRODUCED
- Category: Admin console and controls
- Affected Component: apps/api/src/admin/inviteCode.ts
- Reachability: `createAdminInvite` is the only caller. No route registers it.
- Original Contributors / Sources: New tests outside the existing registry, 2026-10-30

## 3. Root Cause

`generateInviteCode` indexes the alphabet with `Math.floor(Math.random() * alphabet.length)`. OTP and payment-link tokens were moved to `crypto.randomInt` in [BUG-029](bug-029-otp-and-payment-link-insecure-rng.md). This helper was left on `Math.random`.

## 4. Affected Files and Functions

- `apps/api/src/admin/inviteCode.ts` — `generateInviteCode`, called by `createAdminInvite`

## 5. Expected Behavior

Each character comes from `crypto.randomInt`. Replacing `Math.random` does not change the code.

## 6. Actual Behavior

With `Math.random` forced to return 0, an 8-character code is `AAAAAAAA`.

## 7. Trigger Conditions

Any call to `generateInviteCode` or `createAdminInvite`.

## 8. Technical Evidence

```ts
code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
```

## 9. Runtime Evidence

`apps/api/src/admin/inviteCode.new.test.ts` stubbed `Math.random` to `() => 0` and observed `AAAAAAAA`.

## 10. Security / Financial / Functional Impact

A predictable invite code can be guessed and redeemed for the invited email if this path is exposed. It is not exposed by a route today. The alphabet still omits ambiguous characters (`0`, `O`, `1`, `I`).

## 11. Safe Reproduction

Stub `Math.random` to return 0 and call `generateInviteCode(8)` in a unit test. Do not insert an invite row.

## 12. Related Findings

[BUG-029](bug-029-otp-and-payment-link-insecure-rng.md) fixed the same generator for OTP codes and payment-link tokens.

## 13. Documentation Contradictions

The comment calls the result an onboarding code. The shared random helper already documents `crypto.randomInt` as the generator for secrets.

## 14. Recommended Remediation

Draw characters with `randomFromAlphabet`.

## 15. Remaining Questions and Limitations

`admin_invites` is written only if a future route calls `createAdminInvite`. This fix is in the generator, not a new route.

## 16. Original Reports Merged

None.

## 17. Evidence References

`apps/api/src/admin/inviteCode.ts`, `apps/api/src/lib/random.ts`, `apps/api/src/admin/inviteCode.new.test.ts`.
