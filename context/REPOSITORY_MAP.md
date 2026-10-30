# Repository Map — FilsPay Monorepo

> **Scope:** Directory layouts, entry points, package boundaries, file locations, and structural responsibilities across the entire repository.

---

## 1. Top-Level Directory Layout

```text
fils-pay/
├── apps/                       # Applications (services and frontends)
│   ├── admin/                  # Operations console frontend (Vite/React, Port 5174)
│   ├── api/                    # Core Fastify API gateway & webhook dispatcher (Port 3000)
│   ├── reporting/              # Analytics read-model projection worker
│   ├── settlement/             # Go financial settlement daemon & CLI
│   └── web/                    # Merchant dashboard & checkout UI (Vite/React, Port 5173)
├── packages/                   # Shared libraries (npm workspaces)
│   ├── events/                 # Outbox event schemas & enqueue utilities
│   └── money/                  # Protected BHD monetary arithmetic & Fils type
├── db/                         # Database migrations, runner, and seed scripts
│   ├── migrations/             # 72 numbered SQL migration files (0001 to 0078)
│   ├── seed/                   # Database seed fixtures and validation
│   └── migrate.ts              # Custom idempotent SQL migration runner
├── scripts/                    # Maintenance, ops janitors, and reconciliation scripts
│   ├── expire_holds.ts         # Hold expiration janitor script
│   ├── reconcile_march.ts      # Historical March scheme residue reconciliation script
│   └── lib/                    # SQL filter builder utilities
├── ops/                        # Docker Compose, environment configuration, and dev preview
│   ├── docker-compose.yml      # Multi-service stack (postgres, migrate, api, settlement, reporting)
│   ├── preview.mjs             # Vite proxy runner for web (:5173) and admin (:5174)
│   ├── setup-env.mjs           # Local .env.docker generator
│   └── README.md               # Infrastructure documentation
├── docs/                       # Architecture docs, runbooks, and Architecture Decision Records (ADRs)
│   ├── adr/                    # Architecture Decision Records 0001–0006
│   ├── ARCHITECTURE.md         # System architecture specification
│   ├── ADMIN.md                # Admin console operator guide
│   ├── RUNBOOK.md              # Operational runbook
│   └── HANDOVER.md             # Historical handover notes (YA, April 2026)
├── Evidence/                   # Bug registry, audit trails, and agent implementation evidence
│   ├── bugs/                   # Canonical bug files BUG-001 through BUG-086 + Readme.md
│   └── implementation/         # Verification records from previous workstreams
├── context/                    # Persistent repository context system (AI agent shared memory)
├── AGENTS.md                   # Authoritative shared instructions for all coding agents
├── CLAUDE.md                   # Claude-specific execution instructions
├── GEMINI.md                   # Gemini-specific execution instructions
├── package.json                # Root package configuration & workspaces
├── tsconfig.base.json          # Shared TypeScript base configuration
└── tsconfig.json               # Root TypeScript project reference
```

---

## 2. Applications (`apps/`)

### 1. `apps/api` (Fastify REST Gateway)
- **Primary Entry Point:** `apps/api/src/index.ts` (boots Fastify, connects DB pool, starts webhook dispatcher).
- **App Factory:** `apps/api/src/app.ts` (`buildApp(config, pool)` registers plugins and route trees).
- **Config Loader:** `apps/api/src/config.ts` (loads and validates environment variables).
- **Directory Structure:**
  - `src/acquirer/`: Acquirer simulator (`simulator.ts`), HMAC signature verification (`verify.ts`), types.
  - `src/admin/`: Admin domain logic (API keys, balance adjustments, bulk KYC, credit approval).
  - `src/adminAudit/`: Audit logger writing to `admin_audit_log`.
  - `src/adminAuth/`: Admin authentication hooks (`requireAdminSession.ts`, `requireAdminRole.ts`).
  - `src/auth/`: Merchant authentication hooks (`requireMerchantAuth.ts`, `requireMerchantRole.ts`, password verification, OTP challenge handling).
  - `src/fees/`: Merchant fee calculation logic (`calculateMerchantFee.ts`).
  - `src/lib/`: Common utilities (`errors.ts`, `withTransaction.ts`, `validation.ts`).
  - `src/paymentLinks/`: Payment link generation, token claims, and status management.
  - `src/payments/`: Transaction processing (`authorize.ts`, `capture.ts`, `void.ts`).
  - `src/plugins/`: Fastify plugins (`cookies.ts`, `multipart.ts`, `errorHandler.ts`).
  - `src/refunds/`: Refund initiation and calculation (`initiateMerchantRefund.ts`, `processRefund.ts`, `feeReversal.ts`).
  - `src/reporting/`: Merchant analytics and reporting queries (`queries.ts`, `scope.ts`).
  - `src/routes/`: Route modules:
    - `auth.ts`: `/v1/auth` (merchant login, OTP verification, logout).
    - `transactions.ts`: `/v1/transactions` (authorize, capture, void, search).
    - `refunds.ts`: `/v1/refunds` and `/v1/merchants/:merchantId/refunds`.
    - `paymentLinks.ts`: `/v1/merchants/:merchantId/payment-links` and `/v1/payment-links/:token`.
    - `admin*.ts`: `/v1/admin/*` (auth, merchants, KYC, credits, adjustments, settlement triggers).
    - `acquirerCallbacks.ts`: `/v1/acquirer/callback`.
    - `webhooks.ts`: `/v1/merchants/:merchantId/webhook-endpoints`.
    - `health.ts`: `/healthz`, `/readyz`.
  - `src/settlement/`: API integration with settlement worker (`client.ts`).
  - `src/v1/`: **Protected Partner API contract** (`apps/api/src/v1/` — do not modify).
  - `src/webhooks/`: Outbound webhook delivery dispatcher (`dispatcher.ts`), secret encryption (`secretCrypto.ts`), signing (`signature.ts`).

### 2. `apps/settlement` (Go Financial Settlement Engine)
- **Primary Entry Point:** `apps/settlement/cmd/settlement/main.go`.
- **Subcommands:**
  - `settlement daemon`: Starts the background scheduler and internal HTTP API server (`:8091`).
  - `settlement run-batch --date=YYYY-MM-DD [--merchant=<uuid>]`: Manually runs daily batch settlement.
  - `settlement rebuild-balances [--merchant=<uuid>]`: Rebuilds `merchant_balances` cache from the double-entry ledger.
  - `settlement export-scheme-file --batch=<uuid> --out=<path>`: Generates 2-decimal scheme settlement CSV.
- **Directory Structure:**
  - `internal/config/`: Configuration loader reading `DATABASE_URL`, `PGCONN_SETTLEMENT`, `SETTLEMENT_INTERNAL_TOKEN`.
  - `internal/db/`: PostgreSQL connection pool setup (`pgxpool`).
  - `internal/internalapi/`: Authenticated internal HTTP server (`server.go`) for admin plane RPC.
  - `internal/ledger/`: Ledger walk recompute logic for merchant balances.
  - `internal/balances/`: Cache management (`ApplyBatchClose`, `ApplyPayout`).
  - `internal/money/`: Go implementation of `Fils` integer type and arithmetic.
  - `internal/scheduler/`: Background scheduler running daily at Bahrain midnight.
  - `internal/settlement/`: Core settlement algorithms:
    - `batch.go`: Batch claim, fee calculation, net payable deduction.
    - `window.go`: Asia/Bahrain business day window calculations (`BusinessDayWindow`).
    - `payable.go`: Net payable derivation (`NetPayableFils`).
    - `scheme_export.go`: Scheme CSV serialization.
    - `recalculate_mdr.go`: Recalculating MDR across historic batches.

### 3. `apps/reporting` (Outbox Analytics Worker)
- **Primary Entry Point:** `apps/reporting/src/index.ts` (`worker` or `catch-up` subcommands).
- **Directory Structure:**
  - `src/consumer/`: Outbox consumer loop:
    - `runConsumerPass.ts`: Polling loop fetching unprocessed events.
    - `applyEvent.ts`: Materializes events into `merchant_daily_volume` and `merchant_payout_trends`.
    - `cursor.ts`: Manages watermarks in `reporting_outbox_cursor`.
    - `listener.ts`: PostgreSQL `LISTEN/NOTIFY` connection for real-time wakeups.
  - `src/bahrainDate.ts`: Asia/Bahrain date partitioning helper (`toBahrainDateString`).
  - `src/cli/`: CLI recompute commands (`rebuild.ts`).

### 4. `apps/web` (Merchant Portal & Hosted Checkout)
- **Entry Points:** `apps/web/index.html`, `apps/web/src/main.tsx`.
- **Router:** `apps/web/src/router.tsx`.
- **Port:** 5173 (Vite dev server, proxied via `ops/preview.mjs`).
- **Directory Structure:**
  - `src/pages/dashboard-login/`: Password entry and OTP challenge screen.
  - `src/pages/overview/`: Merchant financial KPIs, balance display, recent activity.
  - `src/pages/transactions/`: Transaction search, detail modal, refund drawer.
  - `src/pages/payment-links/`: Link creation and listing.
  - `src/pages/settlement/`: Batch history and downloadable reports.
  - `src/pages/webhooks/`: Webhook endpoint registration, test dispatch, delivery logs.
  - `src/pages/checkout/`: Consumer checkout payment form (`/checkout/:token`).
  - `src/api/`: Typed API client querying `/v1/*`.
  - `src/format.ts`: `formatBhd`, date formatting.

### 5. `apps/admin` (Operations Console)
- **Entry Points:** `apps/admin/index.html`, `apps/admin/src/main.tsx`.
- **Router:** `apps/admin/src/router.tsx`.
- **Port:** 5174 (Vite dev server, proxied via `ops/preview.mjs`).
- **Directory Structure:**
  - `src/pages/login/`: Admin login & OTP authentication.
  - `src/pages/merchants/`: Merchant directory, detail view, onboarding/KYC review, bulk KYC approval.
  - `src/pages/credits/`: Credit request queue, dual-control approval, credit issuance.
  - `src/pages/adjustments/`: Balance adjustments and CSV import tools.
  - `src/pages/settlement/`: Manual batch execution, balance cache rebuild trigger, analytics rebuild.
  - `src/pages/webhooks/`: Emergency webhook batch replay.
  - `src/api/`: Typed client querying `/v1/admin/*`.

---

## 3. Shared Packages (`packages/`)

### 1. `packages/money` (**PROTECTED & FROZEN**)
- **Entry Point:** `packages/money/src/index.ts`.
- **Core File:** `packages/money/src/fils.ts`.
- **Features:**
  - Branded type: `Fils` (`number & { readonly __brand: "Fils" }`).
  - Integer constructors: `toFils(n, { allowNegative?: boolean })`.
  - Arithmetic: `addFils`, `subtractFils`, `negateFils`, `compareFils`.
  - Half-to-even rounding: `bankersRoundDiv(numerator: bigint, denominator: bigint): number`.
  - Rate calculations: `applyRateFils(amount: Fils, rateBps: number): Fils`.
  - Allocation: `allocateRemainder(total: Fils, ratios: number[]): Fils[]`.
  - Formatting & Parsing: `formatBhd(fils: Fils): string`, `parseBhdToFils(text: string): Fils`.

### 2. `packages/events`
- **Entry Point:** `packages/events/src/index.ts`.
- **Core File:** `packages/events/src/outbox.ts`.
- **Features:**
  - Event schemas: `TransactionAuthorized`, `TransactionCaptured`, `TransactionVoided`, `RefundCreated`, `SettlementBatchClosed`, `SettlementPaid`.
  - Database helper: `enqueueEvent(client, eventType, aggregateId, payload)`.

---

## 4. Database & Ops Layout (`db/`, `scripts/`, `ops/`)

- `db/migrate.ts`: Lexically sorts and executes `.sql` files in `db/migrations/`, records in `schema_migrations`.
- `db/migrations/`: 72 migration scripts defining all platform tables, triggers, and indices.
- `db/seed/`: Fixture tables and test merchants; guarded by `ALLOW_DESTRUCTIVE_SEED=1`.
- `scripts/expire_holds.ts`: Sweeps expired authorization holds.
- `scripts/reconcile_march.ts`: Retired CLI (exits 1); pure historical test helpers only, no database or posting capability (PMA-08).
- `ops/docker-compose.yml`: Local orchestrator for PostgreSQL 16, migrate, api, settlement, and reporting.
- `ops/preview.mjs`: Node.js Vite server orchestrator proxying web (:5173) and admin (:5174) to API (:3000).
- `ops/setup-env.mjs`: Generates local keys and tokens into `ops/.env.docker`.
