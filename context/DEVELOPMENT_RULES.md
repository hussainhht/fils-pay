# Development Rules & Architectural Invariants — FilsPay

> **Scope:** Authoritative coding constraints, non-negotiable financial rules, database restrictions, security standards, and Git hygiene.

---

## 1. Absolute Prohibitions (Never Do)

1. **NEVER modify `packages/money/`:**  
   This package is strictly protected and frozen. Only explicit, verified human project authorization can grant an exception.
2. **NEVER modify the `apps/api/src/v1/` partner contract:**  
   External partners integrate against this contract. Route paths, parameter names, and response structures are frozen.
3. **NEVER edit existing migration files:**  
   Never modify any `.sql` file in `db/migrations/`. New schema changes must be added as a new numbered migration file.
4. **NEVER run destructive database commands:**  
   Never run `npm run seed` or execute raw `TRUNCATE` commands on shared, staging, or production databases. Seeding requires `ALLOW_DESTRUCTIVE_SEED=1` on an isolated local database.
5. **NEVER bypass security, auth, or tenant scoping:**  
   Never disable OTP verification, bypass session checks, or allow query parameters to override authenticated tenant context.
6. **NEVER use floating-point numbers for money:**  
   Never use `number` floats, `toFixed(2)`, `parseFloat`, or `Math.round(x * 100) / 100` for financial values. BHD has 3 decimals (1 BD = 1,000 fils).
7. **NEVER weaken or delete tests:**  
   Never skip, comment out, or weaken failing assertions to pass a test suite.
8. **NEVER run destructive Git commands:**  
   Never run `git reset --hard`, `git clean -fd`, `git checkout --`, or force-push.
9. **NEVER read `Evidence/old-agints-instration/`:**  
   The project owner has explicitly forbidden AI agents from reading this directory. Respect this boundary.

---

## 2. Financial & Accounting Rules

1. **Integer Fils Everywhere:**  
   All monetary amounts must be stored in PostgreSQL as `BIGINT` columns ending in `_fils`. In TypeScript, use the branded `Fils` type (`import { toFils, formatBhd } from "@filspay/money"`). In Go, use `money.Fils` (`int64`).
2. **Half-to-Even Rounding (Banker's Rounding):**  
   When calculating rates or fees, always use `bankersRoundDiv(numerator, denominator)` with `bigint` intermediates. Never round half-up via floating point.
3. **Double-Entry Equilibrium:**  
   Every financial transaction must create balanced debit and credit entries in `ledger_entries` sharing a common `entry_group_id`. Migration 0007 enforces:
   $$\sum (\text{debits} - \text{credits}) = 0 \quad \text{per } \text{entry\_group\_id}$$
4. **Multi-Step Atomicity:**  
   Financial mutations, hold updates, ledger insertions, and transactional outbox events must be wrapped inside a single atomic database transaction (`withTransaction` or `client.query("BEGIN")` ... `"COMMIT"`).

---

## 3. Multi-Tenancy & Security Rules

1. **Tenant Scoping from Auth Context:**  
   In all merchant-facing routes, resource ownership must be determined by `request.merchantAuth.merchantId`. Never accept a `merchantId` parameter from the client without verifying that it matches the authenticated session.
2. **Read-Only Admin Impersonation:**  
   Any route that performs a write, creates an entity, or moves money must check whether the actor is an admin impersonator (`request.merchantAuth.actorType === 'admin_impersonation'`) and reject with `403 Forbidden` (`impersonation_read_only`).
3. **Two-Person Rule for Large Credits:**  
   Administrative credit issuance exceeding 50.000 BD (50,000 fils) must be queued into `credit_requests` and approved by a distinct administrator (`created_by !== approved_by`).
4. **Secret Storage & Delivery:**  
   Secrets must be encrypted at rest using AES-256-GCM. Outbound webhooks must be signed with HMAC-SHA256 over raw wire bytes. Inbound callbacks must be verified in constant time (`crypto.timingSafeEqual`).

---

## 4. Coding & Workflow Standards

1. **Smallest Focused Diffs:**  
   Make targeted edits to fix confirmed defects. Do not perform drive-by refactoring, cosmetic reformatting, or dependency updates.
2. **Match Surrounding Style:**  
   Follow established naming conventions, error handling styles, and comment structures in the affected module.
3. **Respect In-Progress Work:**  
   Check `git status` before beginning work. Files with uncommitted changes represent work in progress by other agents or developers. Do not revert or overwrite them.
4. **Mandatory Context Updates:**  
   After completing code changes, update the relevant files in `context/` and add an entry to `context/CHANGELOG.md`. A task is not complete until context documentation is refreshed.
