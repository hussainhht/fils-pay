# EXHIBIT FILE // SYSTEMIC ROOT CAUSE ANALYSIS
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 06_ROOT_CAUSE.md  
**EXHIBIT:** D — The Bugs Were Symptoms: Three Systemic Architectural Failures  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Overview: The Myth of Independent Bugs

FilsPay's 84 cataloged defects were not random programming errors. They were the predictable downstream symptoms of three systemic engineering design failures. Treating each bug as an isolated incident led previous developers into endless whack-a-mole patching. Our forensic audit mapped every critical failure to its architectural origin.

---

## 2. Failure Cascade (Root Cause to Financial Impact)

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 1: AUTOMATION BIAS & FORCED TEST COMPLIANCE                      │
│ Doctrine: "Never read the diff" + "Claude says it is intentional"           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ BUG-010: float32 Settlement  │              │ BUG-009: 10× CSV Import Bug  │
│ 24-bit mantissa overflows    │              │ 4.75 BD parsed as 475 fils   │
└──────────────┬───────────────┘              └──────────────┬───────────────┘
               │                                             │
               └───────────────────────┬─────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ CUMULATIVE FINANCIAL EFFECT: Permanent Ledger-to-Bank Accounting Drift       │
│ Merchants under-credited by 90%; Payouts mismatch banking clearing by fils  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 2: NETWORK I/O EXECUTED INSIDE DATABASE TRANSACTIONS             │
│ Architecture: Awaiting external HTTP acquirer inside active DB row locks    │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ EXHIBIT F: Connection Starve │              │ BUG-006: Double Charging     │
│ 5 pool slots locked during   │              │ Long locks cause timeout     │
│ 250ms external sleep         │              │ client retries reclaim link  │
└──────────────┬───────────────┘              └──────────────┬───────────────┘
               │                                             │
               └───────────────────────┬─────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ SYSTEM IMPACT: Platform Throughput Artificial Plateau at 9 Checkouts/sec    │
│ Duplicate authorizations created; database queue starvation                 │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ ROOT CAUSE 3: DUAL-SOURCE OF TRUTH (CACHE VS IMMUTABLE LEDGER)              │
│ Design: Mutating in-memory cache rows without double-entry journal entries  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ BUG-011: Balances Rebuild    │              │ BUG-038: Cache-Only Adjust   │
│ Reads gross scheme sales,    │              │ Modifies displayed balance   │
│ ignoring fees & refunds      │              │ without journal transaction  │
└──────────────┬───────────────┘              └──────────────┬───────────────┘
               │                                             │
               └───────────────────────┬─────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ AUDIT CONSEQUENCE: Complete Loss of Financial Auditability                   │
│ Merchant dashboard displays numbers that cannot be reconciled in Postgres   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Root Cause Breakdown

### A. Automation Bias & Test Subversion
Under "The Order of the Prompt," developers prioritized keeping the build green over verifying functional correctness. When a CSV parser expected 2 decimal places instead of Bahrain's 3, a test failed. Instead of correcting the parser to 1,000 fils/dinar, the developer altered the test assertion to expect 475 fils and marked the code `// intentional`. When settlement lost precision in `float32`, the Order treated passing unit tests as absolute truth.

### B. Network Latency Inside the Persistence Boundary
In payment processing, synchronous external calls to payment gateways or card acquirers must **never** be executed within database transactions. FilsPay's legacy code opened a database transaction, took a row lock, and then awaited external network I/O. Because the acquirer simulator averaged 250ms per call, the 5-connection PostgreSQL pool became instantly starved, bottlenecking the entire platform at 9 requests per second regardless of server hardware.

### C. State Decoupling from Immutable Ledger Journals
Financial platforms require strict double-entry bookkeeping: every balance change must be the sum of balanced debits and credits. FilsPay introduced a "fast cache" table that was mutated directly by admin endpoints and settlement sweeps. This severed the mathematical link between journal entries and merchant balances, allowing phantom money to appear in dashboards.

---

### Evidence Sources
- `Evidence/codecheck/FilsPay_Complete_Source_Code_Investigation.md` (lines 40–110)
- `apps/api/src/payments/capture.ts` (Network dispatch within transaction)
- `apps/settlement/internal/ledger/rebuild.go` (Cache vs ledger conflict)
- `Evidence/capacity_checkout_load_test.md` (Connection pool starvation metrics)

