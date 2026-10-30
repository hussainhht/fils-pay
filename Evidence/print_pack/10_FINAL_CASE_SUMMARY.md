# EXHIBIT FILE // CASE DISPOSITION & AUDIT CONCLUSION
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 10_FINAL_CASE_SUMMARY.md  
**EXHIBIT:** Final Case Status — What We Fixed, What We Refused to Guess  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Executive Ledger of Case Dispositions

Our investigation closed the gap between superficial tickets and repository reality. We established clear forensic boundaries between what is mathematically proven, what is operationally contained, and what requires upstream business decisions.

```text
┌───────────────────┬──────────────┬──────────────────────────────────────────┐
│ DISPOSITION LEVEL │ COUNT        │ CORE SUBSYSTEMS AFFECTED                 │
├───────────────────┼──────────────┼──────────────────────────────────────────┤
│ CLOSED (VERIFIED) │ 83 Bug Items │ Money, Auth, Holds, Webhooks, Settlements│
│ CONTAINED         │ 5 Risk Areas │ Rebuild Caches, Refund Debt, Secret Mgmt │
│ OPEN              │ 3 Upstream   │ Acquirer Voids, Scheduled Credits, Checksums │
│ UNCHANGED         │ 3 Invariants │ ADR 0003 Windows, Past Books, Fork Diffs │
└───────────────────┴──────────────┴──────────────────────────────────────────┘
```

---

## 2. Granular Case Status Breakdown

### A. CLOSED — Fully Remediated & Verified by Automated Test Suites
- **Financial Precision (`BUG-009`, `BUG-010`):** Replaced floating-point math in settlement net payouts with 64-bit integer fils; corrected BHD CSV adjustments from 2 to 3 decimal places ($10\times$ fix).
- **Catastrophic Hold Deletion (`BUG-013`):** Neutralized SQL generator flaw in janitor script, protecting active customer authorization holds from platform-wide deletion.
- **Concurrent Checkout Protection (`BUG-006`):** Eliminated payment link double-charging through transactional row-level reservations.
- **Tenant Isolation & Auth (`BUG-001`, `BUG-002`, `BUG-004`):** Quarantined pre-auth sessions; enforced strict user-to-challenge binding; revoked write access on admin impersonation.
- **Webhook Raw Byte Signing (`BUG-045`, `BUG-046`):** Enforced canonical raw byte signature generation and verification (`ya/sign-raw`), halting signature rejection storms.
- **Reconciliation Safety (`PMA-08` / `BUG-033`):** Neutralized executable March sweep script, replacing live database execution with a safe process exit and regression guards.
- **Production OTP Delivery (`PMA-01`):** Integrated HTTPS Resend delivery adapter and RFC 6238 Microsoft Authenticator TOTP support with complete test coverage.

### B. CONTAINED — Mitigated with Documented Operational Boundaries
- **Rebuild Cache vs. Ledger Timing (`PMA-02`, `PMA-09`):** Single-merchant rebuild locks prevent concurrent race corruption, but sequential cache deltas require unified lifecycle alignment.
- **Negative Refund Debt Carry-Forward (`PMA-03`):** Refund-only negative batches are isolated; payout policies must explicitly deduct accumulated debt from future positive cycles.
- **Credential Hygiene (`BUG-057`):** Plaintext secrets expunged from compose files and Git staging; formal provider credential rotation remains an ops dependency.

### C. OPEN — Upstream & Contractual Dependencies
- **Acquirer Authorization Reversal (`BUG-024` / `PMA-06`):** The `void` endpoint releases local database holds; external card pre-authorizations await an upstream acquirer API reversal implementation.
- **Scheduled Future Credits (`PMA-07` / `BUG-043`):** Immediate balance crediting of future-dated requests requires a dedicated cron scheduling lifecycle.
- **Migration Checksums (`PMA-13` / `BUG-081`):** Applied migrations are tracked by filename only; schema hashing requires a formal database tooling upgrade.

### D. DELIBERATELY UNCHANGED — What We Refused to Guess
1. **ADR 0003 Date Windows:** The tension between UTC calendar months and Asia/Bahrain business days is a legal and commercial banking policy decision. Silently editing code without executive consensus would corrupt historical accounting.
2. **Historical Ledger Balances:** We refused to execute ad-hoc balancing SQL queries against past database snapshots without verified bank statement reconciliations. In double-entry bookkeeping, guessing is malpractice.
3. **Unverified External Code:** We rejected speculative, un-audited community patches, accepting changes only when backed by reproducible AST proofs.

---

## 3. Our Investigation Philosophy

Throughout this case, our team adhered to four non-negotiable principles:
1. **Preserve Financial Invariants Above All:** Never compromise double-entry bookkeeping or integer money representation for short-term operational convenience.
2. **Verify Before Changing:** Every bug must be proven with a failing test before touching a single line of production code.
3. **Never Blindly Trust AI:** Treat LLM outputs and comments as hypotheses to be rigorously tested, never as authoritative design decisions.
4. **Prefer Proven Evidence Over Assumptions:** If an edge case cannot be proven against repository artifacts, classify it honestly as unverified.

---

> **FINAL INVESTIGATION RECORD:**  
> The Order of the Prompt commanded: *"Never read the diff."*  
> We investigated, proved, and repaired FilsPay by doing the exact opposite: **we read every single line.**

---

### Evidence Sources
- `Evidence/POST_MERGE_AUDIT_REPORT.md` (Full findings matrix, lines 100–225)
- `Evidence/bugs/Readme.md` (Final catalog and status updates)
- `Evidence/PMA-01_OTP_DELIVERY_FIX.md` and `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md`
- `docs/adr/0001-integer-fils.md` through `0006-display-adjustments.md`

