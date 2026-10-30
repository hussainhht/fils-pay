# EXHIBIT FILE // VERIFIED REMEDIATION & PROOF
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 07_FIX_AND_PROOF.md  
**EXHIBIT:** E — We Did Not Stop at Finding Bugs: Verified Fixes & Empirical Proof  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Verification Philosophy

In a financial system, claiming a bug is "fixed" based on code inspection or AI conversation is unacceptable. Every remediation selected by our team was subjected to strict verification:
1. **Pre-Fix Failure Demonstration:** Verifying that baseline code reproduced the defect.
2. **Implementation of Minimal Safe Remediation:** Addressing root causes without collateral impact on core money primitives.
3. **Automated Proof Execution:** Running automated unit, static, or regression suites that pass deterministically (Exit Code 0).

---

## 2. Four Well-Proven Remediations

### Fix 1: PMA-08 / BUG-033 — Neutralization of Non-Idempotent Reconciliation Sweep

- **BEFORE:** `scripts/reconcile_march.ts` carried a comment `// DO NOT RUN`, but the entrypoint remained fully executable. Invoking it connected to Postgres, aggregated March transactions using UTC dates, minted random UUIDs, and inserted un-deduplicated debit/credit adjustments directly into the ledger. Repeating the run repeatedly multiplied ledger debits with zero idempotency protection.
- **→ FIX:** Completely excised `pg`, `crypto`, and `@filspay/money` database dependencies from the script. Direct CLI execution now prints an explicit security refusal message and immediately terminates with `process.exit(1)`. The module is strictly quarantined, exporting only two pure mathematical helpers. Runbook advice recommending execution was expunged.
- **→ PROOF:** Executed:
  ```powershell
  node --import tsx --test scripts/reconcile_march.test.ts scripts/reconcile_march.retirement.test.ts
  ```
  **Result: 6 passed, 0 failed, 0 skipped (Exit Code 0).** Tests verify that direct CLI execution fails safely, no Postgres client can be instantiated, and package scripts contain zero references to the retired executable.

---

### Fix 2: BUG-009 — Restoration of 3-Decimal Bahraini Dinar CSV Parsing

- **BEFORE:** The administrative balance adjustment parser `parseDecimalMinor` defaulted to 2 decimal places (cents), dividing fractional amounts by 100. When an accountant uploaded `"4.75"` BHD, the parser credited the merchant with **475 fils** instead of **4,750 fils**—a 90% loss of merchant balance. A legacy test had been modified to assert this broken number as "intentional."
- **→ FIX:** Re-engineered decimal parsing to enforce Bahrain's official 3-decimal currency standard (1 BHD = 1,000 fils). Non-numeric and malformed inputs are strictly rejected.
- **→ PROOF:** Executed:
  ```powershell
  node --import tsx --test apps/api/src/admin/adjustmentCsvParsing.new.test.ts
  ```
  **Result: 5 passed, 0 failed, 0 skipped (Exit Code 0).** Confirmed `"4.75"` BD parses exactly to `4750` fils; edge cases (trailing zeros, maximum integers) verified mathematically.

---

### Fix 3: PMA-01 — Production OTP Delivery & Microsoft Authenticator TOTP

- **BEFORE:** In `apps/api/src/auth/notifier.ts`, production mode merely logged code hashes to internal logs; it contained zero delivery adapters. Legitimate merchant and admin logins in production could never receive authentication codes, permanently blocking access.
- **→ FIX:** Built `apps/api/src/auth/otpDelivery.ts` using a direct HTTPS Resend API integration with strict request timeouts (5000ms), sanitized 503 error handling, and complete isolation from response bodies. In addition, implemented RFC 6238 TOTP support, enabling standard Microsoft Authenticator mobile app enrollment (`MICROSOFT_AUTHENTICATOR_INTEGRATION.md`).
- **→ PROOF:** Executed:
  ```powershell
  node --import tsx --test apps/api/src/auth/otp.test.ts apps/api/src/auth/loginLimits.new.test.ts
  ```
  **Result: 57 distinct unit/mock HTTP scenarios passed (0 unresolved failures).** Confirms correct recipient routing, rate-limit preservation, and absence of credential exposure. Full TypeScript check passed (`npm.cmd run typecheck` Exit 0).

---

### Fix 4: BUG-013 — Hold Expiration Janitor SQL Injection / Table Deletion Guard

- **BEFORE:** In `scripts/expire_holds.ts`, the SQL predicate generator dropped empty input arrays. On any night where no holds had expired, the script generated an unqualified `DELETE FROM holds`, obliterating all active customer authorization holds platform-wide.
- **→ FIX:** Added an atomic precondition checking expired candidate array length; if empty, the script returns immediately before establishing database queries.
- **→ PROOF:** Executed:
  ```powershell
  node --import tsx --test db/seed/safety.new.test.ts
  ```
  **Result: 4 passed, 0 failed, 0 skipped (Exit Code 0).** Verified that empty sets result in zero SQL execution and active holds remain intact.

---

### Evidence Sources
- `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md` (lines 67–77)
- `Evidence/PMA-01_OTP_DELIVERY_FIX.md` (lines 35–45)
- `apps/api/src/admin/adjustmentCsvParsing.new.test.ts`
- `scripts/reconcile_march.retirement.test.ts`
- `db/seed/safety.new.test.ts`

