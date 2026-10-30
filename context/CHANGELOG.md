# Context System Changelog — FilsPay

> **Scope:** Persistent audit trail of all updates, additions, and revisions made to the `context/` knowledge base. Every meaningful change to the repository must append an entry here.

## 2026-10-30 — Remote server frontend deployment

- Baseline `1f88a47ee619e87728219ad531df4dc4e4cbad56`; deployed sanitized source
  plus new production templates to `68.183.82.221` over authorized SSH.
- Added separate production Node build/Compose/nginx templates and an operational
  runbook, preserving the local development stack and protected application code.
- Public IP merchant/admin static pages and assets verified; PostgreSQL 16 and
  reporting/settlement run privately with separate non-superuser roles and all
  79 existing migrations. No accounts or financial fixture data were seeded.
- API remains inactive because real Resend configuration is missing. HTTP preview
  does not constitute production login/payment acceptance; HTTPS also remains.
- Typecheck/build/config checks passed. Updated infrastructure, ops module,
  testing and known deployment limits. Full evidence and activation steps are in
  `Evidence/agent-1-server-deployment.md` and `ops/PRODUCTION.md`. No commit/push.

## 2026-10-30 — Webhook audit and verification

- Baseline `13d8161`; external commit `85803e4` occurred during verification
  (the audit agent did not commit). Added definitive `payment.failed` and derived
  `payment_link.expired` notifications using existing outbox/delivery infrastructure.
- Bounded preparation/transport exception retries, capped final jitter, applied
  development DNS checks, validated callback field types/UUID/time, and aligned
  capture apply locks with prepare to remove a reproduced same-key deadlock.
- Added lifecycle/local receiver, concurrency, rollback, recovery and transport
  regressions; preserved all four prior envelopes and partner HTTP contracts.
- Refreshed stale event helper signature/types, notification channel, replay
  identity, headers and callback route in relevant module/system context.
- Local raw-byte HMAC delivery and actual process-restart recovery verified;
  typecheck, reporting/events tests and UI builds passed. Comprehensive final
  test results and production limits are recorded in
  `Evidence/webhook_audit_and_implementation.md`. No schema, money or Go changes.

## 2026-10-30 — PMA-08 / BUG-033 retirement safety

- Baseline `1c3f99e0c5478e1ff616898cdfc1cd6f5283172d`; removed the retired March
  script's DB dependency and poster. CLI exits 1; imports retain pure helpers.
- Replaced unsafe month-end runbook instructions. Added four safety regressions;
  11 database-free script tests and repository typecheck pass.
- Updated scripts module, dependency map, architecture/decision source correction,
  testing and known issues. BUG-033 becomes `fix-verified` for future prevention.
- Go settlement suite passes its runnable tests, with DB tests skipped because
  DATABASE_URL is unset. Historical financial data remains unverified.
- Evidence: `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md`. No financial records,
  migrations, protected money implementation, or supported settlement code changed.

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

## 2026-10-30 ? PMA-01 OTP delivery implementation

- Baseline HEAD c3eb21830dd133a47e86bf5f9150a3ba8f9caffd. Added shared Resend HTTPS adapter with native fetch, no dependencies/schema changes; merchant login/resend and admin login await post-commit delivery.
- Validate production sender/key/transport and timeout; block production development exposure. Remove OTP logging in every environment. Preserve session/OTP tables, verification, rate limits and resend attempt inheritance.
- Added notifier and mocked HTTP regressions, updated production config test fixtures without weakening assertions, documented deployment settings and failure recovery.
- Refreshed AUTH_AND_SECURITY, modules/apps-api, INFRASTRUCTURE, DEPENDENCY_MAP, DECISIONS, TESTING and KNOWN_ISSUES. Schema/API route tables and frontend modules reviewed: no schema, route shape or frontend changes needed.
- See Evidence/PMA-01_OTP_DELIVERY_FIX.md for exact validation. External delivery and Postgres integration remain blocked; PMA-01 not declared fully resolved.

## 2026-10-30 ? Microsoft Authenticator TOTP integration

- Added maintained otplib/qrcode dependencies and user-approved migration 0085 with separate authenticator tables; migration not applied here. No financial/partner contract changes.
- Added encrypted, session-owned enrollment, QR/manual setup, confirmation, replay-safe TOTP and single-use recovery, authenticated replacement and other-session revocation. Updated admin audit types.
- Integrated login factor selection/recovery UI and shared Account security pages in merchant/admin shells. Added explicit fail-closed TOTP-only email-disabled production mode; no password-only bootstrap.
- Updated auth/API/database/frontend/module/dependency/infrastructure/decision/test/known-issue context and ops deployment instructions. Focused tests/builds only, per user request. See Evidence/MICROSOFT_AUTHENTICATOR_INTEGRATION.md for exact verification and remaining DB/device/provider gates.

## 2026-10-30 - PMA-08 / BUG-033 retired reconciliation safety

Removed all database/posting implementation from scripts/reconcile_march.ts; direct CLI refuses with exit 1 and import retains pure historical helpers only. Added retirement regression coverage; 6/6 focused tests and repository typecheck pass. Removed unsafe runbook execution guidance and updated the canonical bug, registry, scripts module, dependency map, decisions, repository map, context status and testing documentation. Baseline HEAD c3eb21830dd133a47e86bf5f9150a3ba8f9caffd. Historical financial impact remains unverified and no records were changed; see Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md. Existing unrelated working changes were preserved.

## 2026-10-30 - Hosted checkout UI redesign

Baseline HEAD 2ee8df0a691e0bc0fe3624b4aa40e90f20d87617. Replaced narrow checkout presentation with responsive two-panel green/neutral styling, dynamic merchant/order summary, preserved four-input form, native test disclosure and improved busy/error/result visuals. Added seven presentation/callback tests and an isolated screenshot fixture with original-baseline mode. No payment/API/schema/routing changes. Updated FRONTEND, modules/apps-web, TESTING and KNOWN_ISSUES; corrected stale countdown/reclaim descriptions against source. Reviewed DEPENDENCY_MAP and PAYMENT_FLOWS: no new service/library dependency or financial behavior change; historical PAYMENT_FLOWS reservation SQL remains stale and must not be treated as current code. Validation and remaining limits are in Evidence/ui_checkout_redesign.md. User requested no further testing.

## 2026-10-30 - Checkout screenshot follow-up

Confirmed actual localhost:5173 served an empty checkout CSS transform despite populated source. Rewrote stylesheet to invalidate it and removed BOM; added intrinsic icon/result/illustration SVG dimensions and a failing-before/passing-after regression. Corrected fixture/docs to source /pay/:token route. Web 46/46, build, full typecheck and served module-content checks pass; visual browser check unavailable. Updated checkout evidence, frontend/module/testing/known-issue context. Dependency map and architecture reviewed: no dependency or behavioral change.

## 2026-10-30 � Checkout capacity benchmark preparation

- Baseline `1f88a47ee619e87728219ad531df4dc4e4cbad56`; Docker unavailable. User explicitly requested preparation/source review while leaving the runtime comparison pending and the existing localhost DB untouched.
- Added `scripts/checkout-capacity.mjs`, its real HTTP fixture tests, guarded additive fixture preparer, and separate `ops/capacity/` Compose/init/nginx/stage/SQL tooling. `.dockerignore` excludes generated capacity artifacts.
- Current authorize/capture release transactions before provider waits. Historical BUG-061 wording in the API module is corrected. Missing checkout admission and existing Compose resource enforcement remain source-confirmed gaps; next bottleneck is unmeasured.
- Client tests 4/4 and focused existing tests 20/20 pass; repository typecheck passes. Go available tests pass with temporary cache; DB-backed cases skipped without configuration. Node syntax/PowerShell parsing pass; Docker/Compose/fixture SQL and all actual capacity/correctness measurements remain pending.
- Evidence and exact future commands: `Evidence/agent-1-capacity-optimization.md`. No payment implementation, schema, dependency, protected contract, production template or submitted server changed. Existing context edits were preserved and these findings appended.
