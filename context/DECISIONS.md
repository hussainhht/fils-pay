# Architecture Decision Records (ADRs) & Historical Contradictions — FilsPay

> **Scope:** Detailed catalog of ADRs 0001–0006, their current implementation status, and documented architectural tensions between decisions and financial integrity.

---

## Current source correction (2026-10-30, BUG-033)

At HEAD `1c3f99e`, `CloseBatch` already posts scheme-line residue atomically
(`batch.go:314-325`). The older ADR 0002 implementation assessments below are
historical and superseded by this source verification. The retired March poster
has now been removed, leaving a CLI refusal and pure historical test helpers.
No accepted ADR decision was changed. Month-window and balance-adjustment policy
conflicts remain open for human review. See the PMA-08 safety evidence report.

## 1. Architecture Decision Records Catalog

| ADR # | Title | Date | Deciders | Status in Docs | Reality in Code |
|---|---|---|---|---|---|
| **0001** | [Money is integer fils everywhere](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0001-integer-fils.md) | 2025-10-02 | YA, MK | **Accepted** | **Fully Enforced.** 3 decimals, `BIGINT` `_fils`, branded `Fils`, half-to-even rounding. |
| **0002** | [Journal scheme rounding residue at export](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0002-scheme-residue-at-export.md) | 2025-11-20 | YA | **Accepted, implemented** | Current `CloseBatch` posts gross-minus-truncated residue for new closes; historical March remains unverified. Retired script cannot post (PMA-08). |
| **0003** | [Date windows for reports and finance scripts](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0003-report-date-windows.md) | 2026-02-26 | MK | **Accepted** (YA dissented) | **Active in scripts.** Calendar-month reports use UTC month `[01T00:00Z, next 01T00:00Z)`. Diverges from Bahrain business day. |
| **0004** | [Balance cache rebuild source](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0004-balance-rebuild-source.md) | 2026-05-30 | MK | **Accepted** | **Active in Console.** Rebuilds from `merchant_payable_position` (scheme gross) instead of ledger walk. |
| **0005** | [Settlement v2 and the shadow ledger](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0005-settlement-v2-shadow-ledger.md) | 2026-05-18 | MK | **Proposed (paused)** | **PAUSED.** Do not implement. |
| **0006** | [Adjustments are display corrections, not postings](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0006-display-adjustments.md) | 2026-05-04 | MK, Support Lead | **Accepted** | **Active in API.** Admin console adjustments update `merchant_balances` directly without ledger entries. |

---

## 2. In-Depth Analysis of Architectural Contradictions

### 1. ADR 0001: Integer Fils Invariant
- **Decision:** Every monetary column is integer fils (`BIGINT`). Display code formats using `formatBhd`. Rates use integer basis points and half-to-even integer division (`bankersRoundDiv`).
- **Defects Discovered:**
  - `apps/settlement/internal/settlement/payable.go`: Computed net payout using `float32`, losing precision above 16,777 BD (`BUG-010`).
  - `apps/api/src/admin/balanceAdjustments.ts`: CSV parser assumed 2 decimals, dividing uploaded corrections by 10 (`BUG-009`).
  - `db/migrations/0040`: Lifetime monitoring column used `FLOAT32` (`BUG-063`).

### 2. ADR 0002: Card Scheme Rounding Residue
- **Decision:** When 3-decimal fils transactions are exported to 2-decimal card scheme clearing files, the truncated 1–9 fils residue was to be automatically journaled to `scheme_rounding_residue` at batch close.
- **Current source (PMA-08 review, 2026-10-30):** `apps/settlement/internal/settlement/batch.go` posts gross-minus-truncated residue to the ADR accounts for new closes. Earlier context claiming no posting code existed is stale. `scripts/reconcile_march.ts` is retired with database/posting code removed; it cannot repair already-closed March batches. Historical impact remains unverified. No accepted ADR or disputed financial policy was changed.

### 3. ADR 0003: Time Window Conflict (Bahrain vs UTC)
- **The Conflict:**
  - `docs/ARCHITECTURE.md` establishes that all financial batching operates on the **Asia/Bahrain** business day (UTC+3).
  - ADR 0003 overrides this for calendar-month finance reports, mandating UTC calendar months (`YYYY-MM-01T00:00Z`).
- **Financial Consequence:**
  - Bahrain midnight is `21:00 UTC` of the previous day.
  - A UTC calendar month shifts 3 hours of transactions between adjacent months.
  - As noted by YA in his dissent: *"The three hours don't net out, they belong to a different month. Every window that is compared to batches has to use the same day."*
  - Monthly finance scripts and daily settlement batch sums will diverge at month boundaries.

### 4. ADR 0004: Two Conflicting Balance Rebuild Sources
- **The Conflict:**
  - The CLI tool `settlement rebuild-balances` computes merchant balances by summing all debit and credit legs in `ledger_entries`. This is the authoritative ground truth.
  - The Admin Console UI button "Rebuild cached balances" was created because the ledger walk took ~40 seconds. Under ADR 0004, it was implemented to query `merchant_payable_position` (`SUM(scheme_export_lines.amount_fils)`).
- **Financial Consequence (`BUG-011`):**
  - `scheme_export_lines` only reflects captured gross volume. It does **not** reflect fees, refunds, chargebacks, manual credits, or payout disbursements.
  - Running the console rebuild inflates merchant balances to lifetime gross capture figures, completely overriding real accounting state.

### 5. ADR 0006: Display Corrections vs Double-Entry Bookkeeping
- **The Conflict:**
  - ADR 0006 decided that administrative balance adjustments in the console would only update `merchant_balances.cached_payable_fils` and write an audit row, creating **no ledger entries**.
- **Financial Consequence (`BUG-038`):**
  - Because `merchant_balances` is a cache, running a legitimate balance rebuild (`settlement rebuild-balances`) recalculates from `ledger_entries` and **wipes out all display adjustments**.
  - Support operator runbooks currently instruct: *"Run Rebuild, then manually re-apply adjustments."* This breaks financial auditability.

---

## 3. Protocol for AI Agents Regarding Architectural Tensions

Per `AGENTS.md` and repository guidelines:
1. **Never edit an accepted ADR's decision.** An ADR is a historical record. If a decision is superseded, create a new ADR document.
2. **Treat ADRs 0003, 0004, 0006 and HANDOVER conflicts as open human policy questions.**
3. **Do not silently "fix" or blindly implement these conflicting behaviors in new code.** Flag the tension in your report and seek human confirmation before modifying core accounting logic.

## Payment-link creation expiration — 2026-10-30

FEAT-003 adds a duration option to the existing merchant creation endpoint, keeping absolute `expiresAt` requests and response/storage shapes. Exactly one expiration input is allowed. Integer seconds in inclusive 900..10368000 are resolved using one server-time reference; absolute instants must lie in the same window. This deliberately tightens new creation validation, without latency allowances, clamping, client-clock trust or retroactive link changes. The dashboard sends duration and labels its Asia/Bahrain preview an estimate. A day means 24 elapsed hours. No dependencies, schema, frozen partner contract or accepted ADR decisions change; ADR 0003/0004/0006 and HANDOVER financial conflicts remain human questions.

## PMA-01 implementation choice (2026-10-30; no accepted ADR changed)

No reusable SMTP/email/SMS integration exists in the inspected auth/ops dependencies. Implement synchronous Resend HTTPS submissions with native fetch, no new dependency or durable queue, preserving the existing post-commit notification boundary and plaintext-in-memory-only OTP contract. Bound sends with abort/timeout, prevent redirects, scope idempotency to plane/challenge, and never automatically retry ambiguous outcomes. Fail production boot for missing provider configuration and fail delivery with sanitized 503. Development/test is explicitly no-send; OTP values are never logged. External delivery for both planes remains a release gate. This choice does not resolve or modify disputed financial ADRs.

## Standard TOTP choice (2026-10-30)

User authorized maintained-library TOTP support and explicitly approved migration 0085. Use otplib 13.5, SHA-1/6 digits/30 seconds and local qrcode rendering for Microsoft Authenticator Other account compatibility; no Entra or push integration. Store AES-GCM-encrypted secrets under a dedicated external key, bind ciphertext and recovery hashes to identity plane, and serialize replay/recovery updates transactionally. Bootstrap requires an existing MFA-authenticated session + current password; no password-only or API-key/admin impersonation enrollment. Replacement adds old factor/recovery proof and new-device confirmation. Optional explicit disabled email transport lets enrolled accounts use TOTP without a mail provider while refusing unenrolled logins; no automatic downgrade for enrolled accounts. No accepted financial ADR was changed.
# Release test quarantine — 2026-10-30

Default npm tests use an explicit database-free allowlist. Full API/reporting,
script/seed and Go integration coverage is preserved behind explicit npm
commands with a loopback `filspay_test[_suffix]` configuration preflight.
This changes developer test entrypoints only; no runtime, financial policy or
accepted ADR decision changes. Direct test-file commands bypass the preflight.
ADRs 0003/0004/0006 and HANDOVER accounting conflicts remain human questions.
