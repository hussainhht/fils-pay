# Master Bug & Known Issues Registry — FilsPay

> **Scope:** Consolidated tracking registry of all 86 documented bugs (`BUG-001` through `BUG-086`), current remediation status, priority ratings, root causes, and verification state.

---

## 1. Registry Status Summary (Baseline HEAD `e4cb706`)

| Category | Count | Description |
|---|---|---|
| **Total Registered Reports** | **86** | Sequentially cataloged `BUG-001` through `BUG-086`. |
| **Fix Verified** | **10** | Fix implemented and verified with tests (BUG-001, 002, 014, 015, 016, 017, 022, 029, 054, 058). |
| **Patched (Verification Blocked)** | **8** | Code patch merged or prepared, but integration verification is blocked by missing PostgreSQL environment (BUG-004, 019, 021, 025, 039, 040, 041, 042). |
| **Confirmed Current (Open)** | **68** | Confirmed defects present in current codebase requiring implementation or architectural resolution. |

### Severity Taxonomy
- **P0 Blocker:** Direct fund loss, unauthorized money movement, authentication bypass, data destruction, or broken core lifecycle.
- **P1 Critical:** Cryptographic weakness, financial calculation drift, unauthenticated endpoints, tenant crossover, or broken state transitions.
- **P2 Important:** Significant feature failure, race conditions, display discrepancies, performance bottlenecks, or webhook retries.
- **P3 Low:** Minor UI formatting, documentation drift, or non-critical debt.

---

## 2. P0 Blocker Defects

| ID | Title & Summary | Status | Root Cause & Code Reference |
|---|---|---|---|
| **BUG-001** | Merchant login grants full access without entering OTP | `fix-verified` | Pre-handler accepted session with `pending_otp = true`. Resolved in `apps/api/src/auth/requireMerchantAuth.ts`. |
| **BUG-002** | OTP and session bound to different merchant | `fix-verified` | Session merchant was not checked against user merchant. Resolved in `apps/api/src/routes/auth.ts`. |
| **BUG-003** | Cross-merchant refund | `fix-verified` | `apps/api/src/refunds/initiateMerchantRefund.ts:60` and `payments/processRefund.ts:126` scope target to caller merchant. |
| **BUG-004** | Admin impersonation grants write access | `patched-blocked` | Saved-filter POST accepted live impersonation grant. `apps/api/src/auth/requireMerchantAuth.ts` patched; DB regression test blocked. |
| **BUG-005** | Payment link paid after expiry via client `submittedAt` | `fix-verified` | Client `submittedAt` timestamp was trusted. Patched to use database `now()`. |
| **BUG-006** | Payment link double charging via concurrent reservation reclaim | `confirmed-current` | `apps/api/src/paymentLinks/pay.ts`: Link reservation lock allows parallel checkout requests to race before acquirer settlement. |
| **BUG-007** | Refund headroom capped at authorized amount instead of captured amount | `fix-verified` | Headroom now calculated as `captured_fils - refunded_fils - pending_fils` (`apps/api/src/payments/processRefund.ts:144`). |
| **BUG-008** | Concurrent refunds both succeed allowing double money out | `fix-verified` | Payment row lock (`FOR UPDATE`) and `pending_refund_reservations` serialize competing refunds. |
| **BUG-009** | Adjustment CSV parser treats BHD as 2-decimal currency (10x reduction) | `confirmed-current` | `apps/api/src/admin/balanceAdjustments.ts`: `parseDecimalMinor` defaults to 2 decimals, converting `4.750 BD` to `475 fils` (`0.475 BD`). |
| **BUG-010** | Settlement net payout computed in Float32 causing precision loss | `confirmed-current` | `apps/settlement/internal/settlement/payable.go:11`: Uses `float32(gross)/1000 - float32(fee)/1000`, losing precision above $2^{24}$ fils (~16,777 BD). |
| **BUG-011** | Admin recalculate cached balances reads scheme gross instead of ledger | `confirmed-current` | Admin rebuild button queries `merchant_payable_position` (gross scheme export lines) omitting fees, refunds, and payouts. |
| **BUG-012** | Merchant status recomputation clears test mode flag | `confirmed-current` | `apps/api/src/admin/`: Admin status recompute script clears `merchants.test_mode`, causing test captures to enter live settlement. |
| **BUG-013** | Janitor script deletes all active holds when 0 expired holds found | `confirmed-current` | `scripts/expire_holds.ts` + `scripts/lib/sqlFilter.ts:10`: When `expiredIds` is empty, query becomes `DELETE FROM holds` (wipes table). |
| **BUG-014** | Fresh database migrations fail at 0054/0055 | `fix-verified` | Missing view dependencies and chart of accounts references resolved in fresh migrations. |

---

## 3. High-Priority (P1 Critical) Defects

| ID | Title & Summary | Status | Root Cause & Code Reference |
|---|---|---|---|
| **BUG-015** | OTP attempt limit is racy and resend resets guess budget | `fix-verified` | Challenge attempts counter incremented atomically and resend preserves attempt count. |
| **BUG-016** | Session token not rotated on OTP promotion | `fix-verified` | Token rotated to fresh random bytes upon OTP verification in `apps/api/src/routes/auth.ts`. |
| **BUG-017** | Suspending a merchant does not revoke active session tokens | `fix-verified` | Session lookup checks merchant `status === 'approved'`. |
| **BUG-018** | Payment link cancellation endpoint lacks merchant scoping | `fix-verified` | Scoped by `merchant_id` in `apps/api/src/paymentLinks/cancel.ts`. |
| **BUG-019** | Reporting scope allows parent to query unauthorized split child (IDOR) | `patched-blocked` | `apps/api/src/reporting/scope.ts` patched to validate parentage in `merchant_split_children`. DB test blocked. |
| **BUG-020** | Reporting export summary endpoint lacks auth pre-handler | `patched-blocked` | Added `requireMerchantAuth` to `/v1/reporting/export-summary`. |
| **BUG-021** | Capture idempotency key not bound to transaction ID | `patched-blocked` | Request hash in `apps/api/src/payments/capture.ts` now hashes `transactionId`. DB test blocked. |
| **BUG-022** | Public payment link endpoint leaks API key prefix/hash | `fix-verified` | Removed key prefix and hash from public DTO in `apps/api/src/paymentLinks/read.ts`. |
| **BUG-023** | Negotiated fee discount skipped for payment link captures | `confirmed-current` | `apps/api/src/paymentLinks/pay.ts`: Capture executes without factoring in `merchants.discount_bps`. |
| **BUG-024** | Void operation does not reverse external acquirer authorization hold | `confirmed-current` | `apps/api/src/payments/void.ts`: Releases local hold, but acquirer interface lacks reversal method. |
| **BUG-025** | Capture ignores hold expiry and captures expired authorizations | `patched-blocked` | `apps/api/src/payments/capture.ts` patched to query and lock active hold. DB test blocked. |
| **BUG-026** | Zero-discount capture events allow repeated rebate adjustments | `confirmed-current` | Re-executing capture on retried discount events posts duplicate credit adjustments. |
| **BUG-027** | `POST /v1/refunds` returns 501 Not Implemented | `confirmed-current` | Feature gated behind `FEATURE_REFUNDS=false` in `apps/api/src/config.ts`. |
| **BUG-028** | Refund with null reason violates DB constraint leaving idempotency key stuck | `confirmed-current` | `apps/api/src/payments/processRefund.ts`: Defaults null reason to `'unspecified'`. |
| **BUG-029** | Insecure PRNG (`Math.random`) used for OTP and payment link tokens | `fix-verified` | Switched to `crypto.randomInt` and `crypto.randomBytes` across auth and payment links. |
| **BUG-030** | Split payouts drop fractional fils due to independent banker's rounding | `confirmed-current` | `apps/settlement/internal/splits/`: Independent rounding of child splits leaves undistributed fils. |
| **BUG-031** | Platform volume counter uses 32-bit integer overflowing at 2.1M BD | `confirmed-current` | `db/migrations/0049_platform_stats.sql`: `total_processed_fils` is `INTEGER`, overflows at 2,147,483,647 fils. |
| **BUG-032** | TypeScript API and Go settlement fee formulas diverge | `confirmed-current` | Divergence between `calculateMerchantFee.ts` and `batch.go` on tiered fee schedule handling. |
| **BUG-033** | Retired March residue sweep could post repeatedly | `fix-verified` | PMA-08 removed database/posting code; direct CLI exits 1 and imports preserve pure helpers only. Historical ledger impact remains unverified; see `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md`. |
| **BUG-034** | Scheme export rounds amounts while ledger truncates creating surplus | `confirmed-current` | `apps/settlement/internal/settlement/scheme_export.go`: Quantizes to 2 decimals using rounding rather than truncation. |
| **BUG-035** | MDR recalculation rewrites batches that are already paid out | `confirmed-current` | `apps/settlement/internal/settlement/recalculate_mdr.go`: Mutates paid batch records directly. |
| **BUG-036** | Daily settlement close runs at 03:15 Bahrain time instead of midnight | `confirmed-current` | `apps/settlement/internal/scheduler/`: Cron trigger set to 03:15. |
| **BUG-037** | Settlement batch closure freezes arbitrary dates permanently | `confirmed-current` | No check ensuring a requested business date has actually elapsed before closing it. |
| **BUG-038** | Admin balance adjustment modifies cache only bypassing ledger | `confirmed-current` | `apps/api/src/admin/balanceAdjustments.ts`: Updates `merchant_balances` directly without ledger entries. |
| **BUG-039** | API key rotation mints new key without revoking existing key | `patched-blocked` | Patched `apps/api/src/admin/apiKeys.ts` to revoke predecessor key immediately. |
| **BUG-040** | Two-person rule credit approval compares display name instead of user ID | `patched-blocked` | Patched `apps/api/src/admin/creditApproval.ts` to check `created_by !== approved_by` by UUID. Unit test passed. |
| **BUG-041** | Credit adjustment creation endpoint lacks administrator role check | `patched-blocked` | Added `requireAdminRole('finance', 'super_admin')` to `apps/api/src/routes/adminCredits.ts`. |
| **BUG-042** | Bulk KYC approval transitions pending merchants directly to approved | `patched-blocked` | Added check for `onboarding_status = 'under_review'` in `apps/api/src/admin/bulkKyc.ts`. |
| **BUG-043** | Manual credit creation allows backdating into closed settlement periods | `confirmed-current` | Allows specifying historical `occurred_at` prior to closed batch dates. |
| **BUG-044** | Adjustment CSV import lacks deduplication posting duplicate entries | `confirmed-current` | Re-uploading the same CSV re-applies all balance adjustments without deduplication. |
| **BUG-045** | Webhook HMAC computed over canonical JSON while wire body is stringified | `confirmed-current` | `apps/api/src/webhooks/dispatcher.ts`: Signature computed over serialized object, not raw wire bytes. |
| **BUG-046** | Inbound acquirer HMAC verification re-serializes parsed JSON | `confirmed-current` | `apps/api/src/routes/acquirerCallbacks.ts`: Validates HMAC over parsed body rather than raw payload. |
| **BUG-047** | Acquirer callbacks accepted unsigned by default in configuration | `confirmed-current` | `apps/api/src/config.ts`: `ACQUIRER_CALLBACK_REQUIRE_SIGNATURE` defaults to `false`. |
| **BUG-048** | Duplicate acquirer callbacks append duplicate transaction notes | `confirmed-current` | No deduplication table for inbound acquirer callback event IDs. |
| **BUG-049** | Duplicate `settlement.paid` notifications dispatched by concurrent triggers | `confirmed-current` | Worker restart replays NOTIFY wakeups, causing double webhook dispatch. |
| **BUG-050** | Payout disbursement bank record created as side-effect of webhook dispatch | `confirmed-current` | `apps/api/src/webhooks/dispatcher.ts`: Inserts `settlement_payout_disbursements` on webhook send. |
| **BUG-051** | Webhook URL registration lacks private network validation (SSRF) | `confirmed-current` | Allows registering `http://127.0.0.1` or `http://169.254.169.254` as webhook destinations. |
| **BUG-052** | Reporting consumer double-applies events on restart | `confirmed-current` | Non-atomic cursor watermark commit in `apps/reporting/src/consumer/cursor.ts`. |
| **BUG-053** | Transaction CSV export pagination drops rows sharing identical timestamp | `confirmed-current` | Uses `occurred_at > $1` without secondary tie-breaker primary key in `ORDER BY`. |
| **BUG-054** | Database seed script executes unconditional TRUNCATE | `fix-verified` | Added `ALLOW_DESTRUCTIVE_SEED=1` protection guard in `db/seed/index.ts`. |
| **BUG-055** | Double-entry ledger and audit tables lack immutability database triggers | `confirmed-current` | Tables permit `UPDATE` and `DELETE` without trigger rejections. |
| **BUG-056** | Admin merchant detail form retains state across route changes | `confirmed-current` | React component in `apps/admin/` retains previous inputs when navigated to another merchant. |
| **BUG-057** | Acquirer secret committed in git and fallback webhook key invalid | `confirmed-current` | Fallback key length in `config.ts` must be verified; committed secrets rotated. |
| **BUG-058** | Docker Compose references missing Dockerfiles | `fix-verified` | `ops/Dockerfile.node` and `ops/Dockerfile.go` added; token defaults aligned. |

---

## 4. Medium & Low Priority Defects Summary (BUG-059 to BUG-086)

- **BUG-061 (P2):** Capture endpoint holds database transaction row lock open across slow acquirer network call (`payments/capture.ts`).
- **BUG-062 (P2):** Transaction CSV export retains formula prefix cells (`=`, `+`, `-`, `@`), enabling spreadsheet formula injection.
- **BUG-063 (P2):** `merchants_lifetime_payout_monitoring_estimate` stores balance in `FLOAT32` column (`migration 0040`).
- **BUG-064 (P2):** Daily settlement loop in Go daemon aborts on first failed merchant, blocking all subsequent merchants in the batch.
- **BUG-065 (P2):** Settlement reconciliation formula subtracts paid batches twice.
- **BUG-068 (P2):** Webhook replay mints a brand-new `delivery_id`, causing merchant receivers to treat replays as new deliveries.
- **BUG-069 (P2):** Webhook dispatcher queue lacks row claim lock (`SKIP LOCKED`), causing duplicate deliveries under concurrent workers.
- **BUG-071 (P2):** Dashboard fee display queries newest created row instead of the currently effective fee schedule.
- **BUG-072 (P2):** Settlement summary query multiplies cumulative captures by capture event count.
- **BUG-076 (P2):** Dashboard date filter uses UTC midnight instead of Asia/Bahrain midnight, clipping the first 3 hours of the day.
- **BUG-077 (P2):** Payment links list view lacks pagination beyond 100 links.
- **BUG-080 (P2):** `PGCONN_SETTLEMENT` silently overrides `DATABASE_URL` in `apps/settlement` even when `DATABASE_URL` is explicitly set.
- **BUG-081 (P3):** Migration runner `db/migrate.ts` lacks checksum verification.
- **BUG-082 (P3):** Settlement progress bar divides fils by 10,000 instead of 1,000, distorting UI ratio.
- **BUG-083 (P3):** Admin "View as Merchant" opens unregistered root route instead of `/dashboard`.
- **BUG-084 (P3):** Recent ledger activity query includes the entire exclusive end date.
- **BUG-085 (P3):** Merchant dashboard document title displays "Checkout".
- **BUG-086 (P1):** Credit fee reversal calculates fee using `merchants.mdr_bps` instead of the effective `fee_schedules` row.

## PMA-01 production OTP delivery (2026-10-30 update)

Status: `unverified` (implementation + mocked unit/HTTP verification complete; DB/external verification blocked). Baseline was confirmed-current P0: merchant/admin production notifiers logged metadata without delivering. Shared Resend adapter now submits after commit, fails securely on provider failure/missing configuration, and prohibits production code exposure. Development/test sends nothing and logs no codes. Do not label fully fix-verified until both planes deliver using authorized production-equivalent provider settings and complete authentication. Evidence: Evidence/PMA-01_OTP_DELIVERY_FIX.md. Historical registry aggregate counts above were not recomputed by this scoped fix.

## Authenticator integration verification gate (2026-10-30)

TOTP implementation is unit/mocked-HTTP verified; deployment remains unverified until migration 0085, dedicated key provisioning, database concurrency tests and a real Microsoft Authenticator scan/login for both planes. PMA-01 email adapter remains implemented but externally unverified. TOTP avoids email for enrolled users; it intentionally cannot bootstrap an unenrolled user from password alone when email is disabled. No operator identity-proof recovery bypass is shipped. Historical bug totals above were not recomputed for this scoped authentication work.
