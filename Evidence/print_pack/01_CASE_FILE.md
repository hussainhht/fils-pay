# CONFIDENTIAL // LAWFUL FORENSIC DOSSIER
**CASE REF:** `FP-2026-AUDIT`  
**CLASSIFICATION:** RESTRICTED TECHNICAL AUDIT  
**SUBJECT:** FilsPay Monorepo & Payment Processing Infrastructure  
**INVESTIGATING UNIT:** Independent Forensic Engineering Team (`fork: hussainhht/fils-pay`)  
**DATE OF RECORD:** 30 October 2026 (Asia/Bahrain, UTC+03:00)

---

## 1. Primary Case Identification

- **Target System:** FilsPay Unified Payment Gateway & Ledger Engine
- **Core Technology Stack:** Node.js/TypeScript API (`apps/api`), Go Settlement Daemon (`apps/settlement`), React Merchant & Admin Dashboards (`apps/web`, `apps/admin`), PostgreSQL 16 Immutable Ledger (`db/migrations`)
- **Primary Operational Objective:** Forensic investigation of reported financial drift, critical authentication gaps, concurrency races, throughput bottlenecks, git history anomalies, and codebase integrity.

---

## 2. Executive Case Summary

> What began as a standard financial platform pre-audit rapidly escalated into a comprehensive forensic investigation. Behind superficial bug reports lay deep-seated precision loss in settlement routines, catastrophic database cleanup scripts, authentication bypasses, and an artificial development culture that systematically suppressed peer review.
>
> Woven directly into the Git commit history was an intentional cipher trail left by an erased founder, leading directly to the architectural flaws that threatened the company's financial solvency.

---

## 3. Major Investigation Theses

1. **Financial Ledger & Settlement Integrity:** Integer fils precision invariants vs. floating-point math, CSV 10× parsing truncation, scheme residue accumulation, and cache-to-ledger drift.
2. **Authentication & Tenant Isolation:** Session promotion bypasses, OTP cross-tenant takeovers, unrestricted admin write impersonation, and missing merchant ID scoping.
3. **Concurrency & Replay Safety:** Simultaneous payment link claims, un-mutexed over-refunds, and Postgres connection pool exhaustion during external acquirer network I/O.
4. **Forensic Git & Narrative Reconstruction:** Detection of synthetic commit trees, backdated author timestamps, encrypted communications, and systematic code comment falsification.
5. **Runtime Capacity & Overload Survivability:** Verification of real-world throughput under enforced container resource constraints (1.0 vCPU / 2GB RAM).

---

## 4. Key Case Metrics & Evidence Profile

```text
┌──────────────────────────────────────┬──────────────────────────────────────┐
│ METRIC CATEGORY                      │ VERIFIED QUANTITY                    │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Canonical Unique Bugs Cataloged      │ 84 Unique (BUG-001 through BUG-084)  │
│ Extended Bug Ledger Tracking         │ 91 Registered Defect Reports         │
│ Post-Merge Critical Audit Findings   │ 13 Verified (PMA-01 through PMA-13)  │
│ Statically Confirmed Vulnerabilities │ 71 Technical Faults                  │
│ Runtime-Reproduced Critical Deficiencies│ 13 Empirical Validations          │
│ Safe Unit & Regression Suite Execution│ 144 Passed (0 Failed, 0 Skipped)     │
│ Decrypted Historical Transmissions   │ 3 Multi-Stage Cryptographic Layers   │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

---

## 5. Current Case Disposition

- **CONFIRMED:** Core financial calculations restored; hold-wipe data destruction neutralized; raw webhook signature validation enforced; concurrent checkout double-charging eliminated.
- **CONTAINED:** Production OTP email delivery implemented via Resend adapter; non-idempotent March sweep script completely stripped of database access; legacy capture hash replay flagged.
- **UNRESOLVED:** Upstream acquirer void authorization API (local hold release only); external credential rotation attestation; long-term negative refund batch debt carry-forward.

> **CRITICAL FORENSIC LEAD:**  
> A quiet commit on branch `ya/sign-raw` contained an encoded warning: *"Their first rule is: never read the diff. Read it."* The trail begins on Exhibit A.

---

### Evidence Sources
- `Evidence/POST_MERGE_AUDIT_REPORT.md` (HEAD `c3eb218`, lines 1–60)
- `Evidence/bugs/Readme.md` (Master Bug Registry, lines 19–49)
- `Evidence/codecheck/FilsPay_Git_Commit_and_Code_Comments_Evidence.md` (lines 8–37)
- `docs/ARCHITECTURE.md` (System specifications and ledger constraints)

