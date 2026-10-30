# Context Status, Freshness & Verification Ledger — FilsPay

> **Scope:** Baseline inspection metadata, document freshness tracking, module coverage metrics, and verification boundaries.

---

## 1. Generation Baseline & Environment

- **Initial Generation Date:** 2026-10-30
- **Git Branch:** `main`
- **Baseline Commit HEAD:** `f0419b2c948a9c7da881c2d159f8449e5f286906` (reviewed and audited from `e4cb706`)
- **Environment:** Windows NT 10.0, Node.js 22.19.0, npm 10.9.3, Go 1.24.2, PostgreSQL 16
- **Status of Working Tree:** Active workspace verified against latest main branch.

---

## 2. Repository Coverage & Inspection Audit

Every major subsystem across the repository was inspected directly against current source code, configuration files, and migrations:

| Subsystem / Module | Path | Inspection Method | Coverage Status | Verification Level |
|---|---|---|---|---|
| **Fastify REST Gateway** | `apps/api` | Static AST / Source Reading | 100% of routes, plugins, auth, fees, payments | **VERIFIED-CODE** (Static) |
| **Settlement Daemon** | `apps/settlement` | Source Code Reading (`.go`) | 100% of CLI, scheduler, batch, fees, internal API | **VERIFIED-CODE** (Static) |
| **Analytics Read Model** | `apps/reporting` | Source Code Reading (`.ts`) | 100% of consumer, cursor, listeners, projections | **VERIFIED-CODE** (Static) |
| **Merchant Dashboard** | `apps/web` | Source Code Reading (`.tsx`) | 100% of router, pages, auth, formatters, checkout | **VERIFIED-CODE** (Static) |
| **Operations Console** | `apps/admin` | Source Code Reading (`.tsx`) | 100% of router, pages, auth, credits, adjustments | **VERIFIED-CODE** (Static) |
| **Monetary Math** | `packages/money` | Source Reading & Unit Tests | 100% of `fils.ts`, test suites (40/40 pass) | **VERIFIED-DEEP** (Tests executed) |
| **Transactional Outbox** | `packages/events` | Source Reading & Unit Tests | 100% of `outbox.ts`, test suites (4/4 pass) | **VERIFIED-DEEP** (Tests executed) |
| **Database & Migrations** | `db/` | SQL Analysis & Runner Check | 72 migration SQL files, runner, seed safety | **VERIFIED-CODE** (Static + 4/4 Seed Test) |
| **Ops & Janitor Scripts** | `scripts/` | Source Code Reading | `expire_holds.ts`, `reconcile_march.ts`, `sqlFilter.ts` | **VERIFIED-CODE** (Static) |
| **Docker & Infrastructure** | `ops/` | Compose & Script Review | `docker-compose.yml`, `preview.mjs`, `setup-env.mjs` | **VERIFIED-CODE** (Static) |
| **Bug Registry** | `Evidence/bugs/` | Dossier Review & Cross-Check | BUG-001 through BUG-086 audited against code | **VERIFIED-CODE** (Static Cross-Check) |
| **Architecture Records** | `docs/adr/` | Textual & Code Comparison | ADRs 0001–0006 compared to current implementations | **VERIFIED-CODE** (Discrepancies identified) |

---

## 3. Freshness & Verification Status per Context Document

| Document | Verification Status | Last Verified Against Commit | Verification Evidence |
|---|---|---|---|
| `context/README.md` | **VERIFIED** | `e4cb706` | Central router aligned with workspace layout and safety invariants. |
| `context/PROJECT_OVERVIEW.md` | **VERIFIED** | `e4cb706` | Aligned with currency mechanics, actors, and architecture. |
| `context/REPOSITORY_MAP.md` | **VERIFIED** | `e4cb706` | Correlated with real filesystem directories and entry points. |
| `context/ARCHITECTURE.md` | **VERIFIED** | `e4cb706` | Checked against migration 0007 trigger, `outbox_events`, and Go settlement. |
| `context/MODULES.md` | **VERIFIED** | `e4cb706` | All 9 core subsystems cataloged. |
| `context/DATABASE.md` | **VERIFIED** | `e4cb706` | Checked against 72 migration files and `migrate.ts`. |
| `context/API.md` | **VERIFIED** | `e4cb706` | Checked against Fastify route registrations in `app.ts` and `internalapi/server.go`. |
| `context/AUTH_AND_SECURITY.md` | **VERIFIED** | `e4cb706` | Checked against `requireMerchantAuth`, `requireAdminSession`, and Argon2id config. |
| `context/PAYMENT_FLOWS.md` | **VERIFIED** | `e4cb706` | Checked against `authorize.ts`, `capture.ts`, `void.ts`, and `processRefund.ts`. |
| `context/FRONTEND.md` | **VERIFIED** | `e4cb706` | Checked against `apps/web/src/router.tsx` and `apps/admin/src/router.tsx`. |
| `context/INFRASTRUCTURE.md` | **VERIFIED** | `e4cb706` | Checked against `ops/docker-compose.yml` and `apps/api/src/config.ts`. |
| `context/TESTING.md` | **VERIFIED** | `e4cb706` | Unit tests executed; database prerequisite limits documented. |
| `context/DEVELOPMENT_RULES.md` | **VERIFIED** | `e4cb706` | Synchronized with `AGENTS.md` and repository invariants. |
| `context/KNOWN_ISSUES.md` | **VERIFIED** | `e4cb706` | Audited against `Evidence/bugs/Readme.md` and current code state. |
| `context/DEPENDENCY_MAP.md` | **VERIFIED** | `e4cb706` | Workspaces, package.json dependencies, and outbox subscriptions mapped. |
| `context/DECISIONS.md` | **VERIFIED** | `e4cb706` | Compared ADR text directly against code implementations. |
| `context/modules/*.md` (9 files) | **VERIFIED** | `e4cb706` | Deep-dives audited against respective package and service sources. |

---

## 4. Documented Discrepancies & Code-vs-Doc Contradictions

The following contradictions between historical documentation and current code are formally tracked:

1. **ADR 0002 Residue Automation (PMA-08 source review, 2026-10-30):** Current `CloseBatch` posts scheme-line gross-minus-truncated residue to the ADR accounts for new closes. Earlier context claiming no implementation existed is stale. Historical March data remains unverified.
2. **ADR 0003 Date Windows:** Monthly reporting scripts use UTC calendar month boundaries, diverging by 3 hours from the Asia/Bahrain business day window mandated in `docs/ARCHITECTURE.md`.
3. **ADR 0004 Balance Rebuild Source:** The console rebuild queries `merchant_payable_position` (gross scheme export lines), omitting fees, refunds, and payouts, causing extreme balance drift compared to the authoritative CLI ledger walk (`BUG-011`).
4. **ADR 0006 Display Adjustments:** Administrative balance adjustments mutate `merchant_balances.cached_payable_fils` without posting to `ledger_entries`, causing adjustments to be wiped on any ledger rebuild (`BUG-038`).
5. **Hold Janitor Truncation:** `docs/HANDOVER.md` claims holds are never deleted and flipped with an UPDATE. Source code in `scripts/expire_holds.ts` executes `DELETE`, and when 0 expired holds exist, deletes the entire `holds` table (`BUG-013`).
6. **Retired Reconciliation (PMA-08, 2026-10-30):** `scripts/reconcile_march.ts` now refuses direct execution and contains no database/posting implementation. Runbook rerun guidance was removed; pure historical helpers remain for tests. Future execution prevention is verified; historical ledger impact is unverified.
7. **Webhook Signing Serialization:** Runbook instructs merchants to re-serialize JSON before HMAC verification; the real defect is that FilsPay computes HMAC over serialized JSON rather than raw wire bytes (`BUG-045`).

---

## 5. Areas Requiring Live Integration & Runtime Verification

The following areas are statically verified in code but marked **UNVERIFIED-RUNTIME** because no live, migrated PostgreSQL database container was available during this inspection pass:
- **Fastify HTTP Route Tests:** Route integration tests in `apps/api/src/routes/*.test.ts` require an active PostgreSQL instance.
- **Reporting Worker Real-Time Event Projections:** Testing outbox consumer wakeups via PostgreSQL `LISTEN/NOTIFY`.
- **End-to-End Browser Journeys:** Interactive browser testing of hosted checkout (`apps/web`) and KYC review (`apps/admin`) against a running API.
