# Context System Changelog — FilsPay

> **Scope:** Persistent audit trail of all updates, additions, and revisions made to the `context/` knowledge base. Every meaningful change to the repository must append an entry here.

---

## [1.1.0] — 2026-10-30

### UI polish layer (frontend only)
- Added `apps/ui/polish.css` (imported last by `apps/ui/console.css`) and new tokens in `apps/ui/tokens.css` (`--fp-input-border`, `--fp-*-soft/-border` status colors, `--fp-ring`, `--fp-shadow-xs/-lg`; `--fp-radius` 8px→10px; thinner 2px focus outline).
- Unified hardcoded slate neutrals with the green-tinted tokens; added button variants (`fp-button-danger`, `fp-button-ghost`), pill status badges with dot indicator, left-accent notices, uppercase table headers, loading-pulse, nav icon states.
- `fp-button-danger` applied to: cancel payment link, void, webhook delete, credit reject, KYC reject (class-only edits; no handler/behavior change).
- Checkout polish lives in `apps/web/src/pages/checkout/CheckoutPage.css` (checkout imports only `tokens.css`).
- No API, schema, money, or auth changes. Verified: typecheck, web/admin builds, 28 web tests. Not verified: rendered visuals (no browser access).
- Affected docs: `context/FRONTEND.md` needs no structural change (design-system detail lives in `Evidence/ui_ux_redesign.md`).

---

## [1.0.0] — 2026-10-30

### Initial Baseline Generation
- **Author:** AI Senior Software Architect / Repository Intelligence Specialist.
- **Baseline Commit HEAD:** `e4cb706fc718ce1a13e3de0fb942ce3ea21fa168`.
- **Branch:** `main`.
- **Environment:** Windows NT, Node.js 22.19.0, npm 10.9.3, Go 1.24.2, PostgreSQL 16.
- **Purpose:** Established the persistent repository context system inside root directory `context/` to serve as shared project memory for all AI agents (Gemini, Claude Code, Codex, Cursor) and human engineers.

### Context Documents Created
- `context/README.md`: Central entry point, router table, and mandatory context protocol.
- `context/PROJECT_OVERVIEW.md`: System mission, BHD 3-decimal mechanics, actors, and core capabilities.
- `context/REPOSITORY_MAP.md`: Monorepo file catalog, workspaces, and directory entry points.
- `context/ARCHITECTURE.md`: Double-entry ledger, balance cache, settlement lifecycle, and outbox messaging.
- `context/MODULES.md`: High-level subsystem inventory and deep-dive links.
- `context/DATABASE.md`: PostgreSQL 16 schema, 72 migrations, table columns, triggers, and seed safety.
- `context/API.md`: HTTP REST API endpoint specifications, admin routes, internal RPC (:8091), and partner contract freeze.
- `context/AUTH_AND_SECURITY.md`: Dual-plane auth, Argon2id, OTP rate limiting, RBAC, view-only impersonation, and HMAC/AES crypto.
- `context/PAYMENT_FLOWS.md`: Authorize, capture, void, payment link single-use reservation locks, and refund headroom calculations.
- `context/FRONTEND.md`: React/Vite UI architecture for `apps/web` (:5173) and `apps/admin` (:5174), Vite proxies, formatting.
- `context/INFRASTRUCTURE.md`: Docker Compose configuration, container sizing, environment variable reference.
- `context/TESTING.md`: Test suite classifications, pure unit vs integration tests, execution commands, and regression discipline.
- `context/DEVELOPMENT_RULES.md`: Non-negotiable financial, security, database, and Git hygiene constraints.
- `context/KNOWN_ISSUES.md`: Master catalog of all 86 registered bugs (`BUG-001` through `BUG-086`), severity, status, and root causes.
- `context/DEPENDENCY_MAP.md`: Inter-workspace dependencies, outbox pub/sub matrix, and change blast-radius analysis.
- `context/DECISIONS.md`: ADRs 0001–0006 analysis, implementation realities, and documented architectural contradictions.
- `context/CONTEXT_STATUS.md`: Freshness tracking, coverage matrix, and verified vs unverified items.
- `context/modules/`: Subsystem deep-dive documentation for all 9 core repository modules.

### Agent Instruction Updates
- Added **Persistent Context Protocol** to `AGENTS.md`, `CLAUDE.md`, and created root-level `GEMINI.md`.

---

## [1.0.1] — 2026-10-30

### Skeptical Verification & Audit Fixes
- **Author:** Antigravity AI Reviewer & Repository Intelligence Specialist.
- **Baseline Commit HEAD:** `f0419b2c948a9c7da881c2d159f8449e5f286906`.
- **Corrections Applied:**
  - `context/DATABASE.md` & `context/modules/db-migrations-seed.md`: Corrected false migration gap claims (clarified that 0054_views.sql, 0055_chart_of_accounts_suspense.sql, and 0056_api_keys_revoke_after.sql exist on disk; cataloged true missing numbers 0039, 0041, 0059, 0062, 0063, 0067 across 72 files up to 0078).
  - `context/API.md`: Corrected 5 invalid/broken admin route paths:
    - Fixed `/v1/admin/adjustments/balance` $\rightarrow$ `POST /v1/admin/merchants/:id/balance-adjustments`.
    - Fixed `/v1/admin/adjustments/import` $\rightarrow$ `POST /v1/admin/adjustment-imports`. Added `GET /v1/admin/adjustment-imports` and `GET .../:id/rows`.
    - Fixed `/v1/admin/credits` $\rightarrow$ disambiguated `POST /v1/admin/merchants/:id/credits` (create) vs `GET /v1/admin/credits` (list).
    - Fixed `/v1/admin/settlement/rebuild-balances` $\rightarrow$ `POST /v1/admin/balances/rebuild`.
    - Fixed `/v1/admin/settlement/rebuild-analytics` $\rightarrow$ `POST /v1/admin/reporting/rebuild`.
  - `context/API.md`: Added missing merchant onboarding routes (`POST /v1/merchants`, business profile `GET`/`PATCH`), KYC document management routes (`/v1/merchants/:id/kyc/documents`), API key management routes (`/v1/merchants/:id/api-keys`), and platform health endpoints (`/healthz`, `/readyz`).
  - `context/API.md`: Added missing admin routes: `POST /v1/admin/impersonation/:grantId/end`, `POST /v1/admin/merchants/:id/mdr-recalculation`, `POST /v1/admin/merchants/:id/transactions/recompute-statuses`, and webhook batch replay/archive endpoints.
  - `context/modules/apps-api.md`: Added `businessProfile.ts`, `kyc.ts`, `apiKeys.ts`, and `analytics.ts` to the route handler catalog.
  - `context/CONTEXT_STATUS.md`: Updated baseline commit reference and audited verification records.

---

## Instructions for Future Context Updates

When completing any coding task:
1. Locate the context files describing the subsystems you modified.
2. Update technical descriptions, schemas, route definitions, or known issue statuses.
3. Append a new dated entry below using the format:
   ```markdown
   ## [Unreleased] / [Version] — YYYY-MM-DD
   - **Task / Ticket:** <Description or ID>
   - **Agent / Author:** <Agent Name>
   - **Files Updated in context/:** <List of files>
   - **Summary:** <Brief summary of what changed in the codebase and context>
   ```
4. If no context files required modification, explicitly record that conclusion in your task completion report.
