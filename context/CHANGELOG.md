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


## 2026-10-30 ? Payment checkout enhancements

- Baseline HEAD: `1c3f99e0c5478e1ff616898cdfc1cd6f5283172d`.
- Replaced the basic card input area with `CardPaymentForm`, numeric caret-aware formatting, network/CVV hints, Luhn and expiration validation, local licensed SVG logos, masked CVV and accessible errors. Retained the existing checkout states and public API.
- Corrected open-link expiry and same-key recovery of uncertain attempts, with synchronous submission guards. Green responsive layout uses existing design tokens.
- No raw-card saving or decorative consent checkbox: provider tokenization and verified customer ownership do not exist. No new dependencies, API/schema changes, protected-module changes or settlement changes.
- Added unit tests, installed-Chromium browser checks, screenshots and `Evidence/payment_checkout_enhancements.md`. Baseline expiry/retry tests fail; enhanced browser checks and local simulator/API/Postgres capture plus balanced ledger pass.
- Updated `FRONTEND`, `PAYMENT_FLOWS`, `modules/apps-web`, `ARCHITECTURE`, `TESTING` and `KNOWN_ISSUES`. Corrected checkout route documentation to `/pay/:token` and replaced obsolete timeout-reclaim descriptions with current durable binding. Reviewed `DEPENDENCY_MAP`: no dependency changes needed.

## 2026-10-30 — Editable BHD amount for payment-link creation

- Baseline HEAD: `1b1f64b2c3a42d53da6bc3e96a77a6ebe66e8392`; clean initial working tree. Current source still used raw fils; the baseline browser regression confirms `1.` lost its period.
- Updated `PaymentLinkCreatePage.tsx`; added `BhdAmountInput.tsx`, `bhdAmount.ts`, colocated unit tests and `apps/web/scripts/paymentLinkAmount.browser.test.mjs`. Decimal placement, native caret and selection are preserved, invalid precision/signs are rejected, and complete drafts normalize only at blur/submit. Existing protected parser converts strings to exact safe-integer fils.
- Verified: 55 web tests; full repository typecheck; web build; 11 Edge browser groups with sandbox API fixtures; all 8 existing payment-link API tests against local PostgreSQL 16.15; real DB SELECT and API/proxy health. Baseline browser regression fails before and passes after. No migrations, seeding or real payments.
- Feature implementation/evidence added to the existing `Evidence/features/features.md` as FEAT-003. Updated `FRONTEND`, `PAYMENT_FLOWS`, `modules/apps-web`, `TESTING` and `KNOWN_ISSUES`. Reviewed `DEPENDENCY_MAP` and architecture/decision implications: no interface, dependency, schema, settlement or architecture changes required.
- Limits: Chromium viewport emulation is not physical mobile testing; paste uses synthetic clipboard events; browser creation uses intercepted API/auth, independently of the real API route tests. Other engines, IME, screen-reader speech, full merchant auth-to-creation and settlement/reporting were not verified.
