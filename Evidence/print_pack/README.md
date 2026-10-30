# FilsPay Physical Investigation Evidence Pack (Print Pack)

This directory contains the curated **10-page physical investigation evidence pack** formatted specifically to be printed on **10 individual A4 sheets** and physically presented to the judges during the FilsPay technical defense.

---

## 1. Master Evidence Pack Inventory

| # | File | Purpose | Strongest Evidence | Print Priority |
|---|---|---|---|---|
| **01** | [`01_CASE_FILE.md`](01_CASE_FILE.md) | Opening Case File FP-2026: Executive summary, forensic taxonomy, investigation metrics, and case disposition. | Post-Merge Audit HEAD `c3eb218`, Bug Registry metrics (84 canonical / 91 tracked), 144 safe passing tests. | **Core** |
| **02** | [`02_THE_STORY.md`](02_THE_STORY.md) | The narrative behind FilsPay: "The Order of the Prompt", Yousif Al-Ansari's rebellion, and the systematic erasure of dissent. | Commit messages from `f7a7a3a2` (5 rules), `925744c5` (float32 dissent), `6f462e12` ("intentional" CSV), and `800e1e62` (revocation). | **High** |
| **03** | [`03_THE_FLAG.md`](03_THE_FLAG.md) | Exhibit A: The multi-stage cryptographic investigation uncovering the repository flag. | Whiteboard Clue ID 10, Base64 (`fe24d26`), Vigenère (`8022020d`), ROT13 (`800e1e62`), and OpenSSL AES-256-CBC decryption (`0af74f0d`). | **Critical (Hand First)** |
| **04** | [`04_GIT_FORENSICS.md`](04_GIT_FORENSICS.md) | Exhibit B: Git history anomalies: synthetic commits, missing changelog hashes, and backdated ghost commits. | Commit tree analysis showing 16 zero-file narrative commits, missing CHANGELOG hashes, and ghost commit `098c2de` authored post-revocation. | **High** |
| **05** | [`05_CRITICAL_FINDINGS.md`](05_CRITICAL_FINDINGS.md) | Exhibit C: Top 5 technical vulnerabilities ranked by financial, security, and data integrity impact. | Source code citations in `payable.go:11` (float32), `pay.ts:43` (double charge), `sessions.ts:57` (auth bypass), `processRefund.ts:243`, and `expire_holds.ts:31`. | **Critical (Hand First)** |
| **06** | [`06_ROOT_CAUSE.md`](06_ROOT_CAUSE.md) | Exhibit D: Systemic root causes: Automation bias, network I/O in DB transactions, and un-journaled cache mutation. | ASCII failure cascade mapping "The Order of the Prompt" to financial drift, connection starvation, and ledger desynchronization. | **Core** |
| **07** | [`07_FIX_AND_PROOF.md`](07_FIX_AND_PROOF.md) | Exhibit E: Verified remediations with before-and-after proof: March script neutralization, CSV scaling, OTP delivery, and hold protection. | Exact test commands and passing logs: `reconcile_march.retirement.test.ts` (6/6 pass), `adjustmentCsvParsing.new.test.ts` (5/5 pass), and seed safety (4/4 pass). | **High** |
| **08** | [`08_SYSTEM_UNDER_PRESSURE.md`](08_SYSTEM_UNDER_PRESSURE.md) | Exhibit F: Empirical capacity and load testing under enforced container resource ceilings (1.0 vCPU / 2GB RAM). | Node.js benchmark table from 1 to 80 users, identifying the 8-user / 9.2 req/s connection pool bottleneck and zero-error recovery. | **Critical (Hand First)** |
| **09** | [`09_AI_INVESTIGATION.md`](09_AI_INVESTIGATION.md) | Exhibit G: AI agent methodology, context slicing, and critical failure case studies where AI was caught hallucinating. | Poisoned prompts in archived `CLAUDE.md` (cents/UTC claims) and the false "Fixed" status on BUG-033 caught by human code review. | **High** |
| **10** | [`10_FINAL_CASE_SUMMARY.md`](10_FINAL_CASE_SUMMARY.md) | Closing Case Dossier: Granular breakdown of Closed, Contained, Open, and Deliberately Unchanged issues. | Comprehensive findings matrix separating proven code fixes from unverified assumptions and human accounting policies. | **Core** |

---

## 2. Recommended Print Order

Print the 10 documents in strict sequential numerical order (**01 through 10**). They are designed to be bound or clipped as a physical 10-page dossier that reads as a cohesive forensic narrative from initial case intake to final case disposition:
1. `01_CASE_FILE.md` — Cover sheet and case overview
2. `02_THE_STORY.md` — The human and ideological conflict
3. `03_THE_FLAG.md` — Exhibit A: The cryptographic solution
4. `04_GIT_FORENSICS.md` — Exhibit B: Git repository provenance
5. `05_CRITICAL_FINDINGS.md` — Exhibit C: The core technical vulnerabilities
6. `06_ROOT_CAUSE.md` — Exhibit D: Architectural fault trees
7. `07_FIX_AND_PROOF.md` — Exhibit E: Verified remediations and tests
8. `08_SYSTEM_UNDER_PRESSURE.md` — Exhibit F: Empirical capacity and load limits
9. `09_AI_INVESTIGATION.md` — Exhibit G: AI oversight and error interception
10. `10_FINAL_CASE_SUMMARY.md` — Closing case summary and engineering philosophy

---

## 3. Three Strongest Pages to Physically Hand to the Judge First

If time is limited or the judges ask to see our most impactful evidence immediately, hand them these three sheets:

1. **[`03_THE_FLAG.md`](03_THE_FLAG.md) (Exhibit A — The Flag):**  
   *Why:* Proves deep forensic investigation of the codebase and physical clues. Demonstrates the complete 4-step cryptographic chain (Base64 → Vigenère `diffs` → ROT13 → OpenSSL AES-256-CBC) leading to the authentic decrypted declaration:  
   `FLAG{order_of_the_prompt_never_read_the_diff}`.
2. **[`05_CRITICAL_FINDINGS.md`](05_CRITICAL_FINDINGS.md) (Exhibit C — What Was Actually Broken):**  
   *Why:* Immediately establishes technical and financial depth. Details five distinct, high-impact bugs across money precision (`float32` net settlement loss), concurrency (payment link double charging), authorization (pre-auth session hijack), and data integrity (janitor hold wipe), complete with source line citations and root causes.
3. **[`08_SYSTEM_UNDER_PRESSURE.md`](08_SYSTEM_UNDER_PRESSURE.md) (Exhibit F — Under Load):**  
   *Why:* Delivers concrete empirical capacity data under strict competition resource constraints (1.0 vCPU / 2GB RAM). Features an exact 8-stage load test table showing the 8-user / 9.2 checkout/sec bottleneck, proves that the bottleneck was PostgreSQL connection pool starvation during external acquirer sleeps, and documents instant recovery with $100\%$ financial conservation.

---

## 4. Claims Requiring Human Verification / Operational Caveats

To uphold strict forensic integrity, the following claims are explicitly qualified as dependent on human policy or external infrastructure:

- **Current-Build Throughput Improvement ([`08_SYSTEM_UNDER_PRESSURE.md`](08_SYSTEM_UNDER_PRESSURE.md)):**  
  The measured plateau of 8 users / 9.2 checkouts/s was recorded against the historical serving container. While current source code moves network I/O outside transactions (`apps/api/src/payments/capture.ts`), this improvement could not be re-benchmarked because Docker tools were unavailable in the audit environment. It is stated honestly as an estimate.
- **ADR 0003 Date Window Policy ([`10_FINAL_CASE_SUMMARY.md`](10_FINAL_CASE_SUMMARY.md)):**  
  The discrepancy between UTC calendar months and Asia/Bahrain business days is a commercial and legal policy question. It has been deliberately left unchanged in code pending executive sign-off.
- **External Email Delivery Provider ([`07_FIX_AND_PROOF.md`](07_FIX_AND_PROOF.md)):**  
  The Resend OTP delivery adapter (`auth/otpDelivery.ts`) is fully unit- and mock-tested (57 passing cases), but sending actual emails to live inboxes requires provisioning authorized API keys in secret management.

---

## 5. Missing Evidence That Prevented Stronger Claims

The team refused to invent evidence where repository artifacts were absent:
- **Docker Daemon Unavailable:** Prevented starting isolated container stacks to measure fresh runtime performance and run full multi-service Go/Node integration tests.
- **Absence of Dedicated Migrated PostgreSQL Instance:** Prevented running end-to-end database-writing auth flows, resulting in these being qualified as unit/mock verified rather than deployed DB verified.
- **Upstream Acquirer Reversal Contract:** The `void` endpoint currently releases holds locally because the acquirer simulator lacks an external authorization reversal API.
- **Historical Banking Records:** Meeting notes mention a historical discrepancy in March, but because original banking statements were unavailable, no retroactive ledger edits were performed.

