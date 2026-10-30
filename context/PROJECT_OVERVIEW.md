# Project Overview — FilsPay

> **Scope:** High-level platform purpose, operational context, business model, currency mechanics, and technical foundation.

---

## 1. System Mission & Business Context

**FilsPay** is a localized payment orchestration gateway and financial settlement engine developed for the Kingdom of Bahrain. 

The platform enables Bahraini merchants to accept card payments via hosted payment links or e-commerce API integrations, provides administrative tools for dispute and risk management, handles acquirer authorization and capture lifecycles, journals all money movements in an immutable double-entry ledger, and executes daily batch settlements with automated merchant bank disbursements.

### Market Context: The Bahraini Dinar (BHD)
Bahrain uses a 3-decimal-place currency:
- **1 Bahraini Dinar (BD) = 1,000 fils.**
- Standard payment systems built for 2-decimal currencies ("cents") silently corrupt financial data when applied to BHD.
- Example: An amount of `4.750 BD` is `4750 fils`. An erroneous 2-decimal parser would convert `4.75` into `475 fils` (`0.475 BD`), causing an immediate 90% loss of funds.
- To prevent rounding errors and float drift, **all internal calculations, database columns, and API parameters represent money as whole integer fils.**

---

## 2. Core Capabilities

1. **Merchant Portal (`apps/web`):**
   - Account onboarding, KYC document submission, and business profile configuration.
   - API key management (creation, rotation, revocation).
   - Real-time transaction monitoring, authorization tracking, and refund initiation.
   - Payment link generation with expiry, custom amounts, and single-use enforcement.
   - Settlement batch visibility and downloadable reconciliation reports.
   - Webhook endpoint configuration, payload signing inspection, and delivery replays.

2. **Hosted Checkout (`apps/web`):**
   - Consumer-facing responsive payment page served at `/checkout/:token`.
   - Single-use token validation with database-backed reservation locks.
   - Cardholder payment submission interfacing with the gateway backend.

3. **Operations Console (`apps/admin`):**
   - Centralized merchant search, status management, and audit inspection.
   - KYC review workflow (document verification, manual approval/rejection, bulk approvals).
   - Financial adjustments and credit issuance with mandatory two-person dual control for values above 50.000 BD.
   - Settlement ops: manual trigger for daily batch runs, balance cache rebuilds, and analytics re-aggregations.
   - Webhook management and emergency replay tools.
   - Controlled administrative merchant impersonation ("View as Merchant") with strict read-only enforcement.

4. **Payment Gateway & API Engine (`apps/api`):**
   - Fastify HTTP API serving merchant, partner, and admin planes.
   - Card lifecycle handlers: Authorize, Capture, Void, and Refund.
   - Acquirer integration with asynchronous callback handling and HMAC signature verification.
   - Reliable webhook delivery engine driven by PostgreSQL `LISTEN/NOTIFY` and fallback polling.

5. **Financial Settlement Worker (`apps/settlement`):**
   - Standalone Go application maintaining financial batch closures.
   - Evaluates merchant MDR (Merchant Discount Rate) against tiered fee schedules.
   - Derives gross capture volume, platform fees, and net merchant disbursements.
   - Generates 2-decimal card scheme export files (with truncation/rounding handling).
   - Manages the `merchant_balances` cached position table.

6. **Analytics & Reporting Worker (`apps/reporting`):**
   - Node.js event-driven projection engine consuming the transactional outbox (`outbox_events`).
   - Maintains real-time aggregates in `merchant_daily_volume` and `merchant_payout_trends`.
   - Isolates analytical workloads from transactional payment tables.

---

## 3. Technology Stack & Workspaces

The repository is organized as an npm workspace monorepo alongside a standalone Go service:

| Workspace / Directory | Runtime / Language | Frameworks / Libraries | Responsibilities |
|---|---|---|---|
| `apps/api` | Node.js 22 (ESM) | Fastify, pg, Argon2 | Public and internal REST APIs, auth, payments, webhooks |
| `apps/settlement` | Go 1.24 | pgx/v5, standard library | Batch closure daemon, fee math, scheme export, internal API (:8091) |
| `apps/reporting` | Node.js 22 (ESM) | pg, tsx | Outbox subscriber, analytics materialization worker |
| `apps/web` | Browser / Node.js | React, Vite, React Router | Merchant portal and customer checkout interface (Port 5173) |
| `apps/admin` | Browser / Node.js | React, Vite, React Router | Operations management console (Port 5174) |
| `packages/money` | Node.js (ESM) | TypeScript (**PROTECTED**) | Branded `Fils` type, banker's rounding, BHD formatting/parsing |
| `packages/events` | Node.js (ESM) | TypeScript | Outbox event schemas, transactional enqueue helpers |
| `db` | Node.js (ESM) | TypeScript, pg | Migration runner (`db/migrate.ts`), 72 SQL migrations, seed fixtures |
| `scripts` | Node.js (ESM) | TypeScript, tsx | Ops utilities: hold expiration janitor, residue reconciliation |
| `ops` | Docker / Node.js | Docker Compose, Vite proxy | Local container orchestration, preview runner, env generation |

Database: **PostgreSQL 16** with `uuid-ossp` and `pgcrypto` extensions.

---

## 4. Key Actors and Roles

### Merchant Plane
- **Owner (`owner`):** Full control over merchant settings, user invitations, API keys, refunds, and financial reporting.
- **Finance (`finance`):** Read-write access to settlements, transactions, refunds, and reports; cannot manage team members or delete endpoints.
- **Support (`support`):** Read-only visibility into transactions, settlements, and payment links; cannot issue refunds or mutate financial state.

### Administrative Plane
- **Super Admin (`super_admin`):** Full platform access, credit approval, bulk KYC operations, and impersonation.
- **Finance Admin (`finance`):** Access to all financial tools, settlement batch runs, credit issuance/approval, and balance adjustments.
- **Support Admin (`support`):** Merchant search, read-only inspection, webhook replay, view-only impersonation, and issuing small credits under approval thresholds.

### External Actors
- **Cardholder / Payer:** End-user completing checkout through a payment link.
- **Acquirer / Card Scheme:** Financial intermediary authorizing and capturing transactions, providing scheme settlement files.

---

## 5. Non-Negotiable System Invariants

1. **Integer Fils Everywhere:** Every money value in the database, API request/response, and internal calculation must be an integer number of fils.
2. **Double-Entry Equilibrium:** Every ledger posting must contain at least two entries with matching `entry_group_id` that sum to exactly 0 fils across debits and credits.
3. **Transaction Immutability:** Once authorized, captured, or voided, the core properties of financial transactions cannot be altered. Changes must be posted as new events or ledger legs.
4. **Tenant Scoping from Auth:** No merchant endpoint may accept `merchant_id` from client-provided query parameters or request bodies to dictate resource ownership. Ownership is derived exclusively from the authenticated session.
5. **No Blind Seeds in Production:** Database seeding wipes fixture tables and requires `ALLOW_DESTRUCTIVE_SEED=1` on local isolated databases. It is blocked in production.
