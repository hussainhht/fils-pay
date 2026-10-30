# EXHIBIT FILE // CRITICAL VULNERABILITY AUDIT
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 05_CRITICAL_FINDINGS.md  
**EXHIBIT:** C — What Was Actually Broken: Top 5 Technical Vulnerabilities  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Finding 1 — Settlement Net Payout Float32 Precision Drift (`BUG-010`)

- **Impact:** Critical financial leakage and accounting drift. In 13 out of 14 September settlement batches with volumes exceeding $2^{24}$ fils ($\approx 16,777$ BHD), calculated net payouts violated basic conservation ($gross - fee \ne net$) by $\pm 1$ to 2 fils per batch, creating permanent accounting discrepancies with banking partners.
- **Evidence:** `apps/settlement/internal/settlement/payable.go:11`; `docs/exports/settlement-batches-2026-09-01_20.csv`.
- **Root Cause:** Payout calculation explicitly cast 64-bit integer fils to 32-bit floating-point numbers (`float32`), exceeding the 24-bit mantissa precision during multi-thousand dinar daily aggregations.
- **Status:** **CONFIRMED & VERIFIED_FIXED.** Completely rewritten to use 64-bit integer math throughout the Go settlement pipeline.

---

## 2. Finding 2 — Payment Link Concurrent Double-Charging (`BUG-006`)

- **Impact:** Direct consumer financial harm. Customers paying via shared or slow links were double-debited, with multiple authorization holds created at the card acquirer for a single merchant invoice.
- **Evidence:** `apps/api/src/paymentLinks/pay.ts:43-48, 98-114`; `docs/incidents/postmortem-2026-05.md`.
- **Root Cause:** A 60-second in-memory reservation mechanism lacked transactional database row locks. When a client timed out or retried, a second buyer session successfully claimed the same payment link before the first authorization committed.
- **Status:** **CONFIRMED & VERIFIED_FIXED.** Implemented database-level `SELECT ... FOR UPDATE` row locking and immutable request-to-reservation binding.

---

## 3. Finding 3 — Pre-Auth Session Bypass & Tenant OTP Hijack (`BUG-001`, `BUG-002`)

- **Impact:** Complete merchant account takeover. An unauthenticated attacker could bypass two-factor authentication or hijack another merchant's session during the OTP challenge window.
- **Evidence:** `apps/api/src/auth/sessions.ts:57-63, 106-111`; `apps/api/src/routes/auth.ts:81-105`.
- **Root Cause:** Pending OTP sessions were minted using full operational session cookies, and the OTP verification endpoint did not cryptographically bind the challenge ID to the authenticated user ID.
- **Status:** **CONFIRMED & VERIFIED_FIXED.** Pending sessions are strictly quarantined in isolated cookies with zero API rights; promotion requires verified TOTP/email tokens with attempt-rate limits.

---

## 4. Finding 4 — Refund Headroom Inflation & Concurrent Draining (`BUG-007`, `BUG-008`)

- **Impact:** Gateway balance depletion. Merchants could refund up to the pre-authorized amount even if only a partial amount was captured, and race conditions allowed duplicate refund executions.
- **Evidence:** `apps/api/src/refunds/processRefund.ts:243, 262-264`; `apps/api/src/refunds/initiateMerchantRefund.ts:62-73`.
- **Root Cause:** Available refund headroom was computed as $authorized - refunded$ instead of $captured - refunded$. Additionally, acquirer network dispatch ran outside database row locks, allowing parallel requests to both succeed.
- **Status:** **CONFIRMED & VERIFIED_FIXED.** Headroom is clamped strictly to settled captured funds; row locks prevent concurrent refund processing.

---

## 5. Finding 5 — Nightly Janitor Deletes Entire Holds Database (`BUG-013`)

- **Impact:** Catastrophic data loss. A nightly cron job wiped all active, unexpired customer pre-authorizations across the entire payment platform.
- **Evidence:** `scripts/expire_holds.ts:31-45`; `db/seed/safety.new.test.ts`.
- **Root Cause:** Dynamic query builder `buildWhere` dropped empty array parameters. When zero expired holds were found, the SQL generated was `DELETE FROM holds` without a `WHERE` predicate.
- **Status:** **CONFIRMED & VERIFIED_FIXED.** Script now verifies array length $> 0$ before executing queries, exiting safely on empty sets.

---

### Evidence Sources
- `Evidence/bugs/bug-001-merchant-otp-bypass.md` through `bug-013-expire-holds-deletes-every-hold.md`
- `Evidence/POST_MERGE_AUDIT_REPORT.md` (lines 63–96)
- `apps/settlement/internal/settlement/payable.go` & `apps/api/src/refunds/processRefund.ts`
- `docs/incidents/postmortem-2026-05.md`

