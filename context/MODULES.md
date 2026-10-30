# Module Directory & Subsystem Catalog — FilsPay

> **Scope:** High-level inventory of all workspaces, applications, shared libraries, and infrastructure modules, their boundaries, key entry points, and detailed context links.

---

## 1. Subsystem Index

```text
├── Applications (apps/)
│   ├── apps/api              -> Core Fastify REST API, webhooks, payments, admin backend
│   ├── apps/settlement       -> Go financial settlement daemon & CLI
│   ├── apps/reporting        -> Outbox-driven analytical projection service
│   ├── apps/web              -> Merchant dashboard & hosted checkout UI
│   └── apps/admin            -> Operations console UI
├── Shared Packages (packages/)
│   ├── packages/money        -> Protected BHD monetary math & branded Fils type
│   └── packages/events       -> Outbox event definitions & enqueue helpers
├── Data & Operations (db/, scripts/, ops/)
│   ├── db/                   -> Migrations (72 files), runner, fixtures, seed safety
│   ├── scripts/              -> Maintenance scripts (hold expiration, reconciliation)
│   └── ops/                  -> Docker Compose, preview proxy, env generator
```

---

## 2. Applications (`apps/`)

### 1. `apps/api` — Gateway & Application Backend
- **Role:** Central HTTP API for merchants, cardholders, and operators. Hosts the payment engine, webhook dispatcher, and acquirer client.
- **Runtime:** Node.js 22 ESM, Fastify framework.
- **Entry Points:** `apps/api/src/index.ts` (daemon), `apps/api/src/app.ts` (Fastify builder).
- **Key Modules:**
  - `src/payments/`: Payment state transitions (`authorize.ts`, `capture.ts`, `void.ts`).
  - `src/refunds/`: Full and partial refund orchestration (`initiateMerchantRefund.ts`, `processRefund.ts`).
  - `src/paymentLinks/`: Single-use payment link creation, reservation, and token validation.
  - `src/auth/` & `src/adminAuth/`: Separate merchant and admin authentication pipelines.
  - `src/webhooks/`: Reliable delivery engine (`dispatcher.ts`), AES-256-GCM secret storage, HMAC-SHA256 signing.
  - `src/v1/`: **Partner API Contract — FROZEN / DO NOT MODIFY**.
- **Dependencies:** `packages/money`, `packages/events`, PostgreSQL 16, `apps/settlement` (via internal HTTP).
- **Module Deep-Dive:** [context/modules/apps-api.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-api.md).

### 2. `apps/settlement` — Financial Settlement Worker
- **Role:** Standalone batch processing engine that claims captured transactions, calculates tiered fees, updates merchant payable balances, disburses payouts, and produces 2-decimal scheme clearing files.
- **Runtime:** Go 1.24 (`github.com/filspay/settlement`).
- **Entry Point:** `apps/settlement/cmd/settlement/main.go`.
- **Subcommands:** `daemon`, `run-batch`, `rebuild-balances`, `export-scheme-file`.
- **Key Packages:**
  - `internal/settlement/`: Batch state machine (`batch.go`), Asia/Bahrain business day calculator (`window.go`), scheme export (`scheme_export.go`).
  - `internal/ledger/`: Ledger-walk balance reconstruction (`recompute.go`).
  - `internal/balances/`: Incremental balance cache operations (`cache.go`).
  - `internal/internalapi/`: Internal authenticated HTTP server (:8091) serving admin requests.
  - `internal/money/`: Go equivalent of integer fils arithmetic.
- **Dependencies:** PostgreSQL 16 (`pgxpool`).
- **Module Deep-Dive:** [context/modules/apps-settlement.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-settlement.md).

### 3. `apps/reporting` — Analytics Read-Model Worker
- **Role:** Background consumer projecting transactional events from `outbox_events` into denormalized aggregate tables for low-latency merchant analytics.
- **Runtime:** Node.js 22 ESM.
- **Entry Point:** `apps/reporting/src/index.ts` (`worker` / `catch-up`).
- **Key Modules:**
  - `src/consumer/`: Outbox polling loop (`runConsumerPass.ts`), event projection dispatcher (`applyEvent.ts`), watermark manager (`cursor.ts`).
  - `src/bahrainDate.ts`: Calendar partition mapping for Asia/Bahrain days.
- **Projections Maintained:** `merchant_daily_volume`, `merchant_payout_trends`.
- **Dependencies:** PostgreSQL 16.
- **Module Deep-Dive:** [context/modules/apps-reporting.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-reporting.md).

### 4. `apps/web` — Merchant Dashboard & Hosted Checkout
- **Role:** Browser frontend delivering the self-service merchant portal and consumer checkout experience.
- **Runtime:** Browser, React 18, Vite, TypeScript.
- **Ports & Routes:** Port 5173 (dev). `/dashboard/*` for merchant portal, `/checkout/:token` for hosted checkout.
- **Key Features:** Password + OTP login, transaction search and CSV export, refund drawer, payment link generator, webhook endpoint manager, checkout form.
- **Dependencies:** Proxies `/v1` to `apps/api` (:3000).
- **Module Deep-Dive:** [context/modules/apps-web.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-web.md).

### 5. `apps/admin` — Operations Console
- **Role:** Internal back-office administration portal for support agents, finance officers, and platform super-administrators.
- **Runtime:** Browser, React 18, Vite, TypeScript.
- **Ports & Routes:** Port 5174 (dev). `/login`, `/merchants`, `/credits`, `/adjustments`, `/settlement`, `/webhooks`.
- **Key Features:** KYC document review & bulk approval, dual-control credit requests (threshold > 50 BD), CSV balance adjustments, settlement batch trigger, balance cache rebuild, read-only merchant impersonation.
- **Dependencies:** Proxies `/v1/admin` to `apps/api` (:3000).
- **Module Deep-Dive:** [context/modules/apps-admin.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/apps-admin.md).

---

## 3. Shared Libraries (`packages/`)

### 1. `packages/money` — Protected Monetary Math
- **Role:** Canonical mathematical engine for Bahraini Dinar arithmetic.
- **Status:** **STRICTLY PROTECTED & FROZEN**. No modifications allowed without verified authorization.
- **Core Abstractions:** Branded `Fils` type, `toFils`, `bankersRoundDiv` (half-to-even division), `applyRateFils`, `allocateRemainder`, `formatBhd`, `parseBhdToFils`.
- **Invariants:** Pure integer math (`bigint` intermediates); zero floating-point arithmetic.
- **Module Deep-Dive:** [context/modules/packages-money.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/packages-money.md).

### 2. `packages/events` — Transactional Outbox
- **Role:** Event schema definitions and transactional publication helpers.
- **Key Functions:** `enqueueEvent(client, eventType, aggregateId, payload)`.
- **Schemas:** `TransactionAuthorized`, `TransactionCaptured`, `TransactionVoided`, `RefundCreated`, `SettlementBatchClosed`, `SettlementPaid`.
- **Module Deep-Dive:** [context/modules/packages-events.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/packages-events.md).

---

## 4. Data & Operations Subsystems

### 1. Database & Migrations (`db/`)
- **Role:** Database migration pipeline and seed fixture management.
- **Files:** `db/migrate.ts` (custom runner applying `db/migrations/*.sql` in lexical order), `db/seed/index.ts` (seed data generator).
- **Safety:** Seed requires `ALLOW_DESTRUCTIVE_SEED=1` on local database.
- **Module Deep-Dive:** [context/modules/db-migrations-seed.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/db-migrations-seed.md).

### 2. Scripts & Operational Infrastructure (`scripts/`, `ops/`)
- **Role:** Janitorial maintenance jobs, Docker Compose environment, and developer proxy runners.
- **Files:** `scripts/expire_holds.ts`, `scripts/reconcile_march.ts`, `ops/docker-compose.yml`, `ops/preview.mjs`, `ops/setup-env.mjs`.
- **Module Deep-Dive:** [context/modules/scripts-and-ops.md](file:///c:/Users/hanwd/OneDrive/Desktop/ff/fils-pay/context/modules/scripts-and-ops.md).
