# Architecture Decision Records (ADRs) & Historical Contradictions — FilsPay

> **Scope:** Detailed catalog of ADRs 0001–0006, their current implementation status, and documented architectural tensions between decisions and financial integrity.

---

## 1. Architecture Decision Records Catalog

| ADR # | Title | Date | Deciders | Status in Docs | Reality in Code |
|---|---|---|---|---|---|
| **0001** | [Money is integer fils everywhere](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0001-integer-fils.md) | 2025-10-02 | YA, MK | **Accepted** | **Fully Enforced.** 3 decimals, `BIGINT` `_fils`, branded `Fils`, half-to-even rounding. |
| **0002** | [Journal scheme rounding residue at export](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/docs/adr/0002-scheme-residue-at-export.md) | 2025-11-20 | YA | **Accepted, implemented** | **NOT Implemented.** Residue calculation exists in manual scripts, but no automated posting exists in `apps/settlement`. |
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
- **The Contradiction:** While the ADR status states "Accepted, implemented", **no residue posting code exists** in `apps/settlement`. Residue was only swept manually by finance using one-off scripts (`scripts/reconcile_march.ts`).

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
