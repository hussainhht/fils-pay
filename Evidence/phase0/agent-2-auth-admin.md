# Phase 0 — Agent 2: Authentication & Admin

Verification only. No fixes applied. Source was read at `c389b261c7b481c2b14d12374a5511a07e67f866`. Bugs on the plan's "already proven" list were not re-demonstrated; each was re-checked against current lines and is still open.

CSV adjustment routes are already `finance` / `super_admin`. The open CSV defects are the fils parser (BUG-009) and missing idempotency (BUG-044), not a missing role gate.

### BUG-001 — Merchant login skips OTP

- **Status:** VERIFIED_OPEN
- **Root cause:** `lookupSession` reads `live_sessions`, and that view only drops revoked or expired rows. A password login inserts `authenticated = false` and sets `fp_sid`. `requireSession` and `requireMerchantAuth` both accept that cookie.
- **Current evidence:** `apps/api/src/auth/sessions.ts:89-93` selects from `live_sessions` with no `authenticated` predicate. `db/migrations/0058_live_sessions.sql:3-12` filters `revoked_at IS NULL AND expires_at > now()` only. `apps/api/src/routes/auth.ts:87-105` issues the pending cookie. Contrast: `apps/api/src/adminAuth/sessions.ts:123-127` still requires `authenticated = true` and `admin_users.status = 'active'`.
- **Existing evidence:** `Evidence/bugs/bug-001-merchant-otp-bypass.md` (static). Plan lists it as already proven. Admin has the missing regression (`apps/api/src/routes/admin.test.ts:206-216`); merchant `sessions.test.ts` never inserts `authenticated = false`. The comment in `apps/api/src/routes/apiKeys.ts:35-36` that `requireSession` checks `authenticated` is false.
- **Fix / resolution:** Add `AND authenticated = true` in `lookupSession` (or the view, if every reader wants that). Add a test that a pending merchant cookie gets 401 on `GET /v1/auth/me`.
- **Dependencies:** Land with BUG-016. Until this predicate exists, OTP does not protect merchant routes, including owner API-key mint (`requireSession` + `requireRole("owner")`).

### BUG-002 — OTP bound to a different merchant

- **Status:** VERIFIED_OPEN
- **Root cause:** Password check is scoped to `(merchant_id, email)`, then discarded. `findOtpRecipient(email)` picks any active `merchant_users` row with that email (`LIMIT 1`, no `merchant_id`, no `ORDER BY`). Challenge, pending session, and the emailed code use that row.
- **Current evidence:** `apps/api/src/routes/auth.ts:60-78` loads `user` for the requested merchant, then `const recipient = await findOtpRecipient(...) ?? user`. `apps/api/src/auth/users.ts:16-21` is the global lookup. `?? user` runs only when the lookup returns null, so a second active merchant with the same email wins.
- **Existing evidence:** `Evidence/bugs/bug-002-otp-sent-to-other-merchant.md`. `apps/api/src/app.test.ts:181-187` checks a single merchant only. `app.test.ts:160-178` proves a wrong password cannot log into the other merchant; it does not prove the OTP recipient stays on the password-checked row.
- **Fix / resolution:** Pass the password-checked `user` into `issueChallenge`, `createPendingSession`, and `sendOtpCode`. Delete `findOtpRecipient`.
- **Dependencies:** Must ship with BUG-001. Otherwise a correct password on merchant B can still open a pending session for merchant A, and BUG-001 makes that session fully authorized.

### BUG-004 — Impersonation grants merchant writes

- **Status:** VERIFIED_OPEN
- **Root cause:** `MERCHANT_ROLE_FOR_ADMIN_ROLE` maps `super_admin` → `owner` and `finance` → `finance`. Capture and void use only `requireMerchantAuth`, so every grant, including `support`, can move money. Grant lookup joins `admin_users` for the role and does not require `status = 'active'`. Nothing in app code sets `admin_impersonation_grants.revoked_at` when an admin is disabled.
- **Current evidence:** `apps/api/src/admin/impersonation.ts:85-88` and `:132`. JSDoc at `:91` and `db/migrations/0035_admin_impersonation_grants.sql:15-18` still say the grant is always `support`. `apps/api/src/routes/transactions.ts:94-125` capture/void have no role and no impersonation deny. `apps/api/src/auth/requireMerchantAuth.ts:129-133` records impersonation writes as `merchant_session`. `apps/api/src/admin/impersonation.ts:117-123` has no `au.status` predicate. `apps/api/src/routes/refunds.ts:23` is the same auth hook and currently returns 501.
- **Existing evidence:** `Evidence/bugs/bug-004-impersonation-grants-write-access.md` (runtime). `apps/api/src/routes/admin.test.ts:1074-1117` covers support only: payment-link and webhook creates return 403. It does not cover capture, void, finance, or `super_admin`. `admin.test.ts:239` notes disable does not cover grants.
- **Fix / resolution:** Force `merchantRole: "support"` for every grant, and reject capture, void, refund, and other money writes when `actorType === "admin_impersonation"`. Also require `admin_users.status = 'active'` on grant lookup. Merchant API-key routes (`apps/api/src/routes/apiKeys.ts:36`) use `requireSession` on `fp_sid`, so the impersonation cookie does not mint keys by itself; do not treat that as the bug being fixed.
- **Dependencies:** Put the deny in `requireMerchantAuth` before refunds are wired (BUG-027, other agent). Role-gated webhook and payment-link routes stay closed only if the mapped role stays `support`.

### BUG-009 — Adjustment CSV posts 10× too few fils

- **Status:** VERIFIED_OPEN
- **Root cause:** The importer parses BHD with a 2-decimal minor-unit helper, then brands that integer as fils. `4.75` becomes 475. `4.750` and `4.755` are truncated to two fraction digits and also become 475.
- **Current evidence:** `apps/api/src/admin/adjustmentCsvParsing.ts:6-8` calls `toFils(parseDecimalMinor(raw))`. `apps/api/src/lib/decimal.ts:4-16` defaults `decimals` to 2 and slices the fraction. `packages/money/src/fils.ts:282-298` `parseBhdToFils` pads to 3 digits (`4.75` → 4750) and already accepts a leading minus. The upload route is role-gated (`apps/api/src/routes/adminAdjustmentImport.ts:41-43`); its comment at `:58` claims `4.750` → 4750, which this parser does not do.
- **Existing evidence:** `Evidence/bugs/bug-009-csv-import-10x-too-small.md` (runtime, already proven). `apps/api/src/admin/adjustmentImport.test.ts:55-70` asserts `4.75` → 475 and total 600 for `4.75` + `1.25`. `packages/money/src/parse_cents_compat.test.ts:9-13` shows the correct parser and is not what the import calls.
- **Fix / resolution:** `return parseBhdToFils(raw)` inside the existing `BadRequestError` catch. Update the locked 475 expectations. Do not keep `parseDecimalMinor` for BHD.
- **Dependencies:** Do this before BUG-044 is relied on in production, so the first accepted upload posts the right fils. Idempotency does not correct rows already posted at 475.

### BUG-012 — Status recompute clears test mode

- **Status:** VERIFIED_OPEN
- **Root cause:** Recompute selects transactions whose status is not `authorized` or `voided`, then counts `authorized` rows in that set, which is always 0. If any row was scanned, `reconcileSandboxFlag` sets `merchants.test_mode = false`.
- **Current evidence:** `apps/api/src/admin/transactionStatusRecompute.ts:26-30` excludes `authorized`. `:47` increments `openAuthorizations` only when `row.status === "authorized"`. `apps/api/src/admin/merchantFlags.ts:10-17` clears the flag. Wired at `apps/api/src/routes/adminMerchantsRecompute.ts:26-28`. Settlement then includes the merchant: `apps/settlement/internal/settlement/batch.go:114-117` requires `status = 'active' AND test_mode = false`.
- **Existing evidence:** `Evidence/bugs/bug-012-recompute-statuses-clears-test-mode.md` (runtime, already proven). No test covers `reconcileSandboxFlag`.
- **Fix / resolution:** Stop calling `reconcileSandboxFlag` from recompute. Leave live promotion as an explicit admin action. Do not change `CloseBatch`.
- **Dependencies:** None inside this cluster. Settlement eligibility already trusts `test_mode`; hand the flag write to this fix only.

### BUG-015 — OTP attempt cap is racy and resend resets it

- **Status:** VERIFIED_OPEN
- **Root cause:** Verify reads `attempt_count`, then increments in a later statement, with no row lock. Resend consumes the old challenge and inserts a new one at the column default `attempt_count = 0`. `issueChallenge` has no parameter for the previous count.
- **Current evidence:** `apps/api/src/routes/auth.ts:144-167` is check-then-update. `apps/api/src/routes/adminAuth.ts:135-159` is the same SELECT; the comment at `:147` claims `FOR UPDATE` and the SQL does not. `apps/api/src/routes/auth.ts:218-229` resend calls `issueChallenge` with no prior count. `apps/api/src/auth/otp.ts:38-50` inserts `max_attempts` only. `db/migrations/0011_otp_challenges.sql:16` defaults `attempt_count` to 0. Admin auth has no resend route.
- **Existing evidence:** `Evidence/bugs/bug-015-otp-attempt-limit-race-and-resend-reset.md` (static). `apps/api/src/app.test.ts:224-231` expects one wrong code to leave the challenge usable, which is the sequential case, not the race or the resend.
- **Fix / resolution:** One `UPDATE … SET attempt_count = attempt_count + 1 WHERE id = $1 AND attempt_count < max_attempts RETURNING …` (or `SELECT … FOR UPDATE` inside the same transaction). On resend, copy the previous `attempt_count` into the new row. Apply the same atomic update on the admin verify path.
- **Dependencies:** Independent of BUG-001, but useless as a control while pending sessions are fully authorized. Weaker while BUG-029 keeps the code predictable.

### BUG-016 — OTP promotion does not rotate the session token

- **Status:** VERIFIED_OPEN
- **Root cause:** Promotion flips `authenticated` and extends `expires_at` on the same `token_hash`. Merchant verify never sends a new `Set-Cookie`, so the browser keeps the pending `maxAge`. Admin verify re-sets the cookie at the full TTL but reuses the same raw token.
- **Current evidence:** `apps/api/src/auth/sessions.ts:50-61` `promoteSession` does not change `token_hash`. `apps/api/src/routes/auth.ts:99-105` sets `maxAge` to `pendingSessionTtlMinutes * 60`. `:171-190` calls `promoteSession` and returns JSON with no `setCookie`. `apps/api/src/adminAuth/sessions.ts:67-77` is the same update. `apps/api/src/routes/adminAuth.ts:181-187` sets `maxAge` to `adminSessionTtlHours * 3600` with the pending `rawToken`.
- **Existing evidence:** `Evidence/bugs/bug-016-session-token-not-rotated-on-otp.md` (static). No test asserts a new token hash or a merchant `Set-Cookie` after OTP.
- **Fix / resolution:** On promote, `randomToken(32)`, store the new hash, return the raw token, and `setCookie` with `maxAge: sessionTtlHours * 3600`. Do the same for admin, replacing the token rather than re-issuing it.
- **Dependencies:** Same change set as BUG-001. Rotation without the `authenticated` predicate still leaves the new cookie valid before OTP if promotion is the only writer of the hash.

### BUG-017 — Suspension does not kill sessions or API keys

- **Status:** VERIFIED_OPEN
- **Root cause:** `merchants.status = 'active'` is enforced on login only. Later session and API-key lookups never join `merchants`. `api_keys.revoke_after` is never read. Authorize checks `onboarding_status`, not `status`. Capture and void check neither.
- **Current evidence:** `apps/api/src/routes/auth.ts:60-64` is the login predicate. `apps/api/src/auth/sessions.ts:89-93` joins `merchant_users` only. `apps/api/src/apiKeys/verify.ts:16-20` is `revoked_at IS NULL` only. `db/migrations/0056_api_keys_revoke_after.sql:1-5` adds the column; repo-wide search shows no other reader. `apps/api/src/payments/authorize.ts:77-91` checks `onboarding_status = 'approved'` only.
- **Existing evidence:** `Evidence/bugs/bug-017-suspended-merchant-credentials-keep-working.md` (static). BUG-039 is the same class of leftover credential after an operator action that looks like revocation.
- **Fix / resolution:** In `lookupSession` and `verifyApiKey`, join `merchants` and reject any status other than `active`. In `verifyApiKey`, also reject `revoke_after <= now()` (or set `revoked_at` in that statement). There is no sweep job to rely on.
- **Dependencies:** Pair with BUG-039. Rotation that does not revoke, plus a verifier that ignores `revoke_after`, leaves the old key live after both "rotate" and "suspend".

### BUG-029 — OTP and payment-link tokens use Math.random

- **Status:** VERIFIED_OPEN
- **Root cause:** `randomDigits` and `randomFromAlphabet` draw from `Math.random`. Merchant and admin OTP both call `generateOtpCode` → `randomDigits`. Public payment-link tokens call `randomFromAlphabet` for 22 characters. `randomToken` (`crypto.randomBytes`) exists and is not used on either path.
- **Current evidence:** OTP (already proven, lines still match): `apps/api/src/lib/random.ts:2-6`, `apps/api/src/auth/otp.ts:7-8`, `apps/api/src/adminAuth/otp.ts:29`. The admin docblock at `adminAuth/otp.ts:13` says `crypto.randomInt`; the call does not. Payment-link portion, checked separately: `apps/api/src/paymentLinks/create.ts:7-12` and `:48` set `token` to `plink_` plus `randomFromAlphabet(TOKEN_ALPHABET, 22)`, inserted at `:50-58`. `apps/api/src/lib/random.ts:10-15` is `Math.random`. `apps/api/src/lib/crypto.ts:4-6` is the CSPRNG already used for session tokens.
- **Existing evidence:** `Evidence/bugs/bug-029-otp-and-payment-link-insecure-rng.md`. OTP portion is on the plan's do-not-redemo list. No runtime sample was taken for the payment-link generator; the call chain above is the proof.
- **Fix / resolution:** Implement `randomDigits` / `randomFromAlphabet` with `crypto.randomInt` (rejection sampling so the alphabet length need not divide the range). Point `randomPlinkToken` at `randomToken` (or `randomInt` over the alphabet) instead of `Math.random`. Leave `displayReference` out of this fix unless it is switched by the shared helper on purpose.
- **Dependencies:** None for the payment-link call site. Do not expand into pay, cancel, or public-read payment-link bugs.

### BUG-038 — Balance adjust writes cache and audit only

- **Status:** VERIFIED_OPEN
- **Root cause:** `POST /:id/balance-adjustments` calls `applyBalanceCorrection`, which locks `merchant_balances`, adds `deltaFils` to `cached_payable_fils`, and writes an audit row. It does not insert `ledger_entries`. `adjustMerchantBalanceJournaled` in the same file does post a ledger group and is not routed.
- **Current evidence:** `apps/api/src/routes/adminBalanceAdjustments.ts:58-71` calls `applyBalanceCorrection`. `apps/api/src/admin/balanceAdjustments.ts:25-63` is cache plus `action: "balance_adjustment"`. `:67-82` `adjustMerchantBalanceJournaled` calls `postLedgerAdjustment`. The route is already `finance` / `super_admin`.
- **Existing evidence:** `Evidence/bugs/bug-038-balance-adjustment-cache-only.md` (runtime, already proven). `balanceAdjustments.test.ts` tests both helpers; the route test only reaches the cache helper.
- **Fix / resolution:** Route the POST handler to `adjustMerchantBalanceJournaled`. Keep rebuilds ledger-sourced so the cache update is a consequence of the journal.
- **Dependencies:** None for the route swap. Settlement rebuild (other agent) will overwrite cache-only corrections until this lands.

### BUG-039 — API key rotation does not revoke the old key

- **Status:** VERIFIED_OPEN
- **Root cause:** Rotation inserts a new key with `rotatedFromKeyId` and an `api_key_rotate` audit row. It never sets `revoked_at` or `revoke_after`. `revokeApiKey` exists and is not called.
- **Current evidence:** `apps/api/src/admin/apiKeys.ts:31-46` issues the new key and returns `previousKeyId`. `apps/api/src/apiKeys/issue.ts:137-142` is the unused revoke. `verifyApiKey` accepts any hash with `revoked_at IS NULL` (`apps/api/src/apiKeys/verify.ts:16-20`).
- **Existing evidence:** `Evidence/bugs/bug-039-api-key-rotation-does-not-revoke.md`. `apps/api/src/routes/admin.test.ts:798-858` asserts the previous key still gets 200 on `GET /v1/transactions` and `revoked_at` is null. The rollback test at `:674-682` is a different claim (a failed rotation must not revoke). The comment at `issue.ts:135-136` that rotation calls `revokeApiKey` is false.
- **Fix / resolution:** In the same transaction, `UPDATE api_keys SET revoked_at = now() WHERE id = $oldId AND revoked_at IS NULL` before commit. Update the success test that locks the overlap. Keep the failed-audit rollback test.
- **Dependencies:** BUG-017. Revocation only helps if `verifyApiKey` honors `revoked_at` (it does) and suspension is enforced separately.

### BUG-040 — Second approver is compared by display name

- **Status:** VERIFIED_OPEN
- **Root cause:** `assertDistinctApprover` throws only when `approver.displayName === requester.displayName`. Both actors carry `adminUserId`, and the approve query loads `requested_by_admin_user_id`, but the predicate ignores the ids. Two admins with the same name cannot approve each other. One person with two accounts and different names can.
- **Current evidence:** `apps/api/src/admin/creditApproval.ts:10-13`. Called from `apps/api/src/admin/credits.ts:326-329` with both ids present. The approve route loads `display_name` solely for this check (`apps/api/src/routes/adminCredits.ts:92-101`).
- **Existing evidence:** `Evidence/bugs/bug-040-second-approver-compares-display-name.md` (runtime, already proven). `creditApproval.test.ts:7-27` uses the same object for the reject case and two different names for the allow case. The comment about a same-id / different-name case is not what the test runs.
- **Fix / resolution:** Compare `adminUserId` only. Add cases for same id with different names (reject) and different ids with the same name (allow).
- **Dependencies:** BUG-041. Name comparison is the above-threshold hole. Under-threshold credits never reach this function.

### BUG-041 — Credit create has no finance role check

- **Status:** VERIFIED_OPEN
- **Root cause:** `POST /merchants/:id/credits` is registered on a scope whose only hook is `requireAdminSession`. Approve and reject sit on a second scope that adds `requireAdminRole("finance", "super_admin")`. `createCreditRequest` does not check role either. When `creditRequiresSecondApprover` is false, it posts to the ledger inside the create transaction.
- **Current evidence:** `apps/api/src/routes/adminCredits.ts:40-76` create vs `:80-82` approve/reject. `apps/api/src/admin/credits.ts:201-261` posts when `!requiresApproval`. The JSDoc at `:201-203` says a support caller gets 403 from this function; the function never checks role. Threshold is base amount only: `apps/api/src/admin/creditThreshold.ts:10-15` (`toFils(50_000)`, 50.000 BD).
- **Existing evidence:** `Evidence/bugs/bug-041-credits-missing-role-check.md` (static). `adminCredits.test.ts` covers a finance admin posting below threshold, not a support caller.
- **Fix / resolution:** Add `requireAdminRole("finance", "super_admin")` on the create route, same as approve. Do not rely on the JSDoc.
- **Dependencies:** Independent of BUG-040. Do it first if the goal is to stop support from posting under-threshold credits with no second person.

### BUG-042 — Bulk KYC approve skips review

- **Status:** VERIFIED_OPEN
- **Root cause:** Bulk approve updates every supplied merchant id to `onboarding_status = 'approved', kyc_passed = true` and writes an admin audit row. It does not require `under_review` and does not insert `merchant_kyc_reviews`. The single-merchant path does both.
- **Current evidence:** `apps/api/src/admin/bulkKyc.ts:26-31` has no status predicate. The JSDoc at `:12-14` says only `under_review` merchants move and others are skipped; the SQL returns every updated id. `apps/api/src/onboarding/review.ts:35-57` `recordKycReviewInTx` inserts the review row and then updates the merchant. The HTTP route is role-gated (`apps/api/src/routes/adminMerchantsBulk.ts:20-22`) and calls `bulkApproveMerchantsKyc` only.
- **Existing evidence:** `Evidence/bugs/bug-042-bulk-kyc-approve-bypasses-review.md` (static, on the already-proven list). The single-merchant rollback test in `admin.test.ts:630-640` shows the review row exists on that path, not on bulk.
- **Fix / resolution:** `WHERE id = ANY($1::uuid[]) AND onboarding_status = 'under_review'`, and call `recordKycReviewInTx` per id inside the same transaction. Keep the audit row.
- **Dependencies:** None. BUG-075 lets a JPEG named `*.pdf` into the queue; bulk approve can then approve that merchant without a review row. Fix both.

### BUG-044 — Adjustment CSV import applies twice

- **Status:** VERIFIED_OPEN
- **Root cause:** Every upload inserts a new `adjustment_imports` row and posts a ledger group per row. The comment says a unique `original_filename` blocks a re-upload. The table has no such constraint, and the filename is caller-supplied (`pasted.csv` when omitted).
- **Current evidence:** `apps/api/src/admin/adjustmentImport.ts:55-67` inserts, then posts. Comment at `:63-64`. `db/migrations/0065_adjustment_imports.sql:5-14` indexes `(uploaded_by_admin_user_id, created_at)` only. `0066` unique `(adjustment_import_id, row_number)` does not span uploads. Route auth is `finance` / `super_admin` (`adminAdjustmentImport.ts:41-43`); the handler comment at `:56-57` says the same file posts twice.
- **Existing evidence:** `Evidence/bugs/bug-044-csv-import-applies-twice.md` (runtime, already proven, including EVID-014). No test uploads the same bytes twice.
- **Fix / resolution:** Hash the file bytes (or the canonical parsed rows) and reject a hash already stored, with a unique index. Do not use `original_filename`.
- **Dependencies:** BUG-009 for the amount that gets posted. A content hash is stable across the parser fix, so it will not by itself repair historical 475-fils rows.

### BUG-075 — KYC PDF rule uses the filename

- **Status:** VERIFIED_OPEN
- **Root cause:** `detectFileType` accepts PDF, JPEG, and PNG for every document type. PDF-only types (`commercial_registration`, `bank_letter`) then require `fileName` to end in `.pdf`. A JPEG whose name ends in `.pdf` passes both checks and is stored with the detected image MIME type. A non-PDF, non-image buffer is rejected, which is a narrower check than the report's rule.
- **Current evidence:** `apps/api/src/onboarding/kyc.ts:50-69`. `detectFileType` is `apps/api/src/onboarding/fileSignature.ts:25-29`. The input JSDoc at `kyc.ts:16` says `fileName` is never used for validation. The comment at `:57` says non-PDF bytes are already rejected for these types; they are not. `fileSignature.ts:1-5` overclaims that any `.pdf` name without `%PDF` is rejected.
- **Existing evidence:** `Evidence/bugs/bug-075-kyc-pdf-check-uses-filename.md` (static). `apps/api/src/app.test.ts:234-248` rejects `fake.pdf` whose bytes are plain text (`invalid_file_type`). That does not cover a JPEG named `x.pdf`.
- **Fix / resolution:** For `PDF_ONLY_DOCUMENT_TYPES`, require `detected === "pdf"`. Keep the extension check only as an extra. Add a regression with JPEG bytes and a `.pdf` name.
- **Dependencies:** None for the predicate. See BUG-042 for bulk approval of whatever this accepts.

## HEAD and working tree

- **HEAD:** `c389b261c7b481c2b14d12374a5511a07e67f866` (`c389b26 plan update`).
- **Tracked tree:** clean at the start and end of this pass (`git diff --stat` empty). No application, test, or migration edits.
- **Untracked:** `Evidence/phase0/` only (this report and other agents' Phase 0 reports). Source lines cited above were not changed during the read.

## Summary counts

| Status | Count | Bugs |
|---|---|---|
| VERIFIED_OPEN | 16 | BUG-001, BUG-002, BUG-004, BUG-009, BUG-012, BUG-015, BUG-016, BUG-017, BUG-029, BUG-038, BUG-039, BUG-040, BUG-041, BUG-042, BUG-044, BUG-075 |
| ALREADY_FIXED | 0 | — |
| FALSE_POSITIVE | 0 | — |
| STALE_REPORT | 0 | — |
| NEEDS_RUNTIME | 0 | — |
| INCONCLUSIVE | 0 | — |

No assigned canonical report is reclassified as stale. Comments that disagree with HEAD are noted inside the entries (impersonation "always support", CSV "unique filename", admin OTP `crypto.randomInt`, KYC "fixed in FP-231", credit-create JSDoc).

## Recommended implementation order

1. BUG-001 and BUG-016 together in session lookup and promote (merchant and admin).
2. BUG-002 in the same login transaction, using the password-checked user.
3. BUG-029 in `random.ts` and `randomPlinkToken`.
4. BUG-015 atomic attempt update, including resend carry-forward and the admin verify path.
5. BUG-017, then BUG-039 in the same API-key transaction (`revoked_at = now()` on the old key; verifier rejects non-active merchants).
6. BUG-041, then BUG-040.
7. BUG-009, then BUG-044.
8. BUG-038 route swap to the journaled helper.
9. BUG-004 force `support` and deny money writes on `admin_impersonation` before refunds leave 501.
10. BUG-042 bulk guard plus `recordKycReviewInTx`.
11. BUG-012 remove the `test_mode` side effect.
12. BUG-075 require `detected === "pdf"` for PDF-only types.

## Cross-agent handoffs

- **BUG-029 payment links:** Generation is verified here (`paymentLinks/create.ts:48` → `Math.random`). Pay, cancel, discount, and public DTO bugs stay with the payment agents. Do not re-investigate those flows for this token.
- **BUG-004 vs refunds:** `refunds.ts` is `requireMerchantAuth` and returns 501. The impersonation deny belongs in `requireMerchantAuth` so the refund agent does not inherit capture/void behavior when the stub is replaced.
- **BUG-012 vs settlement:** `CloseBatch` already requires `test_mode = false` (`batch.go:117`). This fix only stops recompute from clearing the flag. Do not edit settlement eligibility here.
- **BUG-038 vs ledger rebuild:** The journaled helper already calls `postLedgerAdjustment`. Routing to it is this cluster. Rebuild-from-ledger behavior is the settlement agent's button/CLI work; cache-only rows will disappear when that rebuild is honest.
- **BUG-009 / BUG-044:** Admin import only. Scheme export rounding is not this parser.
- **BUG-017:** Enforce status in `lookupSession` and `verifyApiKey`. Do not spread merchant-status checks through capture and void unless those routes keep a second, weaker lookup.
- **BUG-075 / BUG-042:** Upload acceptance and bulk approval are separate. Either one still lets an unreviewed or non-PDF document through.

## Items requiring runtime verification

None of the sixteen need a new runtime run to classify. Static code matches the reports, and the already-proven set was not re-demoed.

After implementation, the cheap checks already in the plan are enough:

- Login without OTP, then `GET /v1/auth/me` → 401 (BUG-001).
- Two merchants, one email: OTP and `merchantId` stay on the password-checked row (BUG-002).
- `parseBhdToFils` path: `4.75` → 4750 fils (BUG-009).
- Second upload of the same CSV bytes is rejected (BUG-044).
- Concurrent OTP guesses cannot exceed `max_attempts` (BUG-015). That one is the only check a single curl will not show.
