# FilsPay Persistent Repository Context System

> **Primary Agent Entry Point**  
> All coding agents (Gemini, Claude Code, Codex, Cursor, human engineers) **MUST** consult this file before exploring or modifying the codebase. Do not initiate full repository scans when documented context is available.

---

## 1. System Overview

**FilsPay** is a multi-tenant payment gateway, merchant acquiring interface, and financial ledger platform built for the Kingdom of Bahrain.

### Core Architectural Invariants
1. **Currency & Minor Units:** All monetary calculations use integer **fils** (1 Bahraini Dinar = 1,000 fils; e.g., 4.750 BD = 4,750 fils). Monetary columns in PostgreSQL end in `_fils` and use `BIGINT`. Floats, `Math.round(x * 100) / 100`, and `toFixed(2)` are strictly forbidden in financial calculations.
2. **Double-Entry Ledger:** Money movements are stored in `ledger_entries` in balanced groups sharing an `entry_group_id`. A deferred constraint trigger enforces that debits and credits balance to zero per group upon transaction commit.
3. **Balance Cache:** `merchant_balances` is a derived performance cache. The authoritative balance is computed from `ledger_entries`.
4. **Settlement Time Window:** Daily settlement operates on the **Asia/Bahrain** business day (UTC+3, fixed, no DST), closing midnight to midnight local time.
5. **Transactional Outbox:** State changes and domain events (`outbox_events`) are committed atomically within the same database transaction.
6. **Dual Security Planes:** Merchant operations (`apps/web`, `/v1/*`) and admin/ops operations (`apps/admin`, `/v1/admin/*`) use completely separate user tables, session cookies (`fp_sid` vs `fp_admin_sid`), and authentication hooks.
7. **Strict Multi-Tenancy:** Merchant tenant scoping is derived solely from the authenticated session context (`request.merchantAuth.merchantId`). It is never accepted from untrusted client input.
8. **Protected Modules:** `packages/money/` is protected and frozen. The partner contract under `apps/api/src/v1/` is frozen.

---

## 2. Context Navigation & Document Index

The `context/` directory provides comprehensive, verified repository intelligence. Load only the documents relevant to your immediate task:

### System-Wide Context
| Document | Purpose | Key Topics Covered |
|---|---|---|
| [PROJECT_OVERVIEW.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/PROJECT_OVERVIEW.md) | High-level system mission & design | Tech stack, business model, currency mechanics, service topology |
| [REPOSITORY_MAP.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/REPOSITORY_MAP.md) | Monorepo layout & file catalog | Directories, package boundaries, entry points, key files |
| [ARCHITECTURE.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/ARCHITECTURE.md) | End-to-end architectural patterns | Outbox pattern, double-entry ledger, settlement lifecycle, security |
| [MODULES.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/MODULES.md) | Module directory and summaries | Directory of all services, libraries, and frontends |
| [DATABASE.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/DATABASE.md) | PostgreSQL schema & migration guide | 72 migrations, table schemas, constraints, triggers, seed safety |
| [API.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/API.md) | HTTP API endpoint specifications | Merchant routes, Admin routes, Acquirer callbacks, Settlement internal API |
| [AUTH_AND_SECURITY.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/AUTH_AND_SECURITY.md) | Authentication & security models | Passwords (Argon2id), OTP, sessions, RBAC, impersonation, HMAC signing |
| [PAYMENT_FLOWS.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/PAYMENT_FLOWS.md) | Transaction & payment mechanics | Authorize, capture, void, payment links, refunds, state transitions |
| [FRONTEND.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/FRONTEND.md) | UI architecture & frontend apps | `apps/web` (merchant + checkout), `apps/admin` (ops console), Vite proxies |
| [INFRASTRUCTURE.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/INFRASTRUCTURE.md) | Docker, config & deployment | Docker Compose, environment variables, local preview, resource limits |
| [TESTING.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/TESTING.md) | Test suites & verification guidelines | Node/tsx tests, Go tests, DB requirement, regression test standards |
| [DEVELOPMENT_RULES.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/DEVELOPMENT_RULES.md) | Invariants & coding standards | Absolute prohibitions, financial rules, style, Git/workspace hygiene |
| [KNOWN_ISSUES.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/KNOWN_ISSUES.md) | Master bug & defect registry | BUG-001 through BUG-086 catalog, status, root cause, reproduction |
| [DEPENDENCY_MAP.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/DEPENDENCY_MAP.md) | Cross-module relationships | Workspace dependency tree, outbox subscriptions, blast radius matrix |
| [DECISIONS.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/DECISIONS.md) | Architecture Decision Records (ADRs) | ADR 0001–0006 analysis, accepted vs implemented, documented conflicts |
| [CHANGELOG.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/CHANGELOG.md) | Context system evolution log | Record of context updates, dates, and baseline commit SHAs |
| [CONTEXT_STATUS.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/CONTEXT_STATUS.md) | Context freshness & verification state | Baseline commit, inspection coverage, verified vs unverified areas |

### Subsystem & Module Deep-Dives (`context/modules/`)
| Module File | Component | Details |
|---|---|---|
| [apps-api.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-api.md) | `apps/api` | Fastify backend, route handlers, middleware, plugins, acquirer client |
| [apps-settlement.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-settlement.md) | `apps/settlement` | Go daemon, scheduler, batch closure, fee calculator, scheme export |
| [apps-reporting.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-reporting.md) | `apps/reporting` | TypeScript outbox consumer, analytics projection tables, date bucketing |
| [apps-web.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-web.md) | `apps/web` | Merchant portal and hosted checkout frontend (React/Vite) |
| [apps-admin.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-admin.md) | `apps/admin` | Operations console (React/Vite), KYC review, credits, adjustments |
| [packages-money.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/packages-money.md) | `packages/money` | Protected monetary math: branded `Fils`, half-to-even rounding, parsing |
| [packages-events.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/packages-events.md) | `packages/events` | Outbox event schemas and `enqueueEvent` transactional utility |
| [db-migrations-seed.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/db-migrations-seed.md) | `db/` | 72 migration SQL files, runner, fixtures, and seed safety protections |
| [scripts-and-ops.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/scripts-and-ops.md) | `scripts/` & `ops/` | Janitor scripts (`expire_holds`), finance scripts (`reconcile_march`), Docker Compose |

---

## 3. Task-to-Context Navigation Router

Before inspecting source code, look up your task type in this table and read the designated context files:

| Task Domain | Primary Context to Read | Secondary Context | Relevant Source Paths |
|---|---|---|---|
| **Merchant Authentication / OTP** | `AUTH_AND_SECURITY.md` + `modules/apps-api.md` | `DATABASE.md` | `apps/api/src/auth/`, `apps/api/src/routes/auth.ts`, `apps/web/src/auth/` |
| **Admin Auth / Impersonation / Roles** | `AUTH_AND_SECURITY.md` + `modules/apps-admin.md` | `API.md` | `apps/api/src/adminAuth/`, `apps/api/src/routes/admin*.ts`, `apps/admin/` |
| **Payment Authorization / Capture / Void** | `PAYMENT_FLOWS.md` + `DATABASE.md` | `modules/apps-api.md` | `apps/api/src/payments/`, `apps/api/src/routes/transactions.ts`, `apps/api/src/acquirer/` |
| **Payment Links / Hosted Checkout** | `PAYMENT_FLOWS.md` + `modules/apps-web.md` | `API.md` | `apps/api/src/paymentLinks/`, `apps/web/src/pages/checkout/` |
| **Refunds Implementation / Fixes** | `PAYMENT_FLOWS.md` + `KNOWN_ISSUES.md` | `modules/apps-api.md` | `apps/api/src/refunds/`, `apps/api/src/routes/refunds.ts`, `apps/web/src/refunds/` |
| **Settlement Batch / Payouts / Fees** | `ARCHITECTURE.md` + `modules/apps-settlement.md` | `DECISIONS.md` | `apps/settlement/cmd/`, `apps/settlement/internal/settlement/` |
| **Balance Cache / Rebuild / Adjustments** | `DECISIONS.md` (ADR 0004/0006) + `DATABASE.md` | `modules/apps-api.md` | `apps/api/src/admin/balanceAdjustments.ts`, `apps/settlement/internal/balances/` |
| **Outbox Events / Webhook Delivery** | `ARCHITECTURE.md` + `modules/apps-api.md` | `packages-events.md` | `packages/events/`, `apps/api/src/webhooks/`, `apps/reporting/` |
| **Analytics Read Model / Reporting** | `modules/apps-reporting.md` + `DATABASE.md` | `ARCHITECTURE.md` | `apps/reporting/src/consumer/`, `apps/api/src/routes/reporting.ts` |
| **Database Schema / Migration Changes** | `DATABASE.md` + `DEPENDENCY_MAP.md` | `DEVELOPMENT_RULES.md` | `db/migrate.ts`, `db/migrations/`, `db/seed/` |
| **Merchant Portal UI / Redesign** | `FRONTEND.md` + `modules/apps-web.md` | `API.md` | `apps/web/src/` |
| **Ops Console UI / Redesign** | `FRONTEND.md` + `modules/apps-admin.md` | `AUTH_AND_SECURITY.md` | `apps/admin/src/` |
| **Docker / Local Stack / Deployment** | `INFRASTRUCTURE.md` + `scripts-and-ops.md` | `DEVELOPMENT_RULES.md` | `ops/`, `docker-compose.yml`, `ops/preview.mjs` |
| **Bug Investigation / Historical Reports** | `KNOWN_ISSUES.md` + `Evidence/bugs/` | Specific module file | Correlate with `BUG-001` .. `BUG-086` |
| **Monetary Calculations / Formatting** | `packages-money.md` + `DEVELOPMENT_RULES.md` | `DECISIONS.md` (ADR 0001) | `packages/money/src/fils.ts` (**PROTECTED**) |

---

## 4. Persistent Context Protocol for AI Agents

All AI agents operating in this repository must adhere to the following workflow:

### Phase 1: Before Every Task
1. Read this file (`context/README.md`).
2. Identify the matching task domain from the router table above.
3. Read **only** the designated primary and secondary context documents.
4. Review documented constraints, invariants, and known defects in that domain.
5. Inspect only the specific source files identified as necessary for the task.
6. Verify whether any context statement contradicts the live code (code is always ground truth).

### Phase 2: During Implementation
1. Adhere strictly to the rules in `DEVELOPMENT_RULES.md`:
   - Never touch `packages/money/` without explicit verified approval.
   - Never modify existing migrations or schema without approval.
   - Never alter the `apps/api/src/v1/` partner contract.
   - Never expose credentials, secret keys, or customer card data.
   - Multi-step financial writes must occur in a single atomic transaction.
   - All tenant scoping must come from authenticated context.
2. Maintain compatibility with downstream and upstream services identified in `DEPENDENCY_MAP.md`.
3. Create a co-located regression test (`*.test.ts`) proving the bug/feature behavior.

### Phase 3: Mandatory Post-Implementation Maintenance
A task is **NOT COMPLETE** until its affected context documentation has been reviewed and updated:
1. Identify all context files that describe the code you touched.
2. Update the technical descriptions, route definitions, schemas, or invariants in those files.
3. Update `context/KNOWN_ISSUES.md` if a bug was resolved, partially addressed, or discovered.
4. Record your change in `context/CHANGELOG.md` with the date, files touched, and rationale.
5. If no context files required modification, explicitly state this in your completion report.

---

## 5. Ground Truth vs Historical Documentation

Historical documentation in `docs/` and `Evidence/` contains known contradictions:
- `docs/ARCHITECTURE.md` states: *"Where it disagrees with the code, the code wins."*
- ADR 0002 claims scheme residue posting is implemented; in the source code it does not exist.
- ADR 0004 & ADR 0006 describe balance rebuilds and adjustments that bypass ledger double-entry bookkeeping.
- `docs/HANDOVER.md` contains outdated claims (e.g., claiming holds are never deleted, whereas `scripts/expire_holds.ts` executes `DELETE`).
- **Always verify claims against source code.** When a discrepancy is detected, update the corresponding `context/` file and document the contradiction.
