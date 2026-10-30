# Module: `apps/admin` (Operations Console)

> **Scope:** Architecture, administrative routing, KYC review workflows, two-person credit approvals, balance adjustments, and settlement triggers.

---

## 1. Purpose & Responsibilities

`apps/admin` is an internal operations management console built with React 18 and Vite. It serves:
1. **Support Agents:** Merchant lookup, transaction inspection, view-only impersonation, and emergency webhook replays.
2. **Finance Officers:** Manual settlement batch triggers, balance cache rebuilds, balance adjustments, and credit approvals.
3. **Super Administrators:** Platform configuration, bulk KYC reviews, and API key rotations.

---

## 2. Main Entry Points & Directory Layout

- **Vite Config:** `apps/admin/vite.config.ts`.
- **HTML Entry:** `apps/admin/index.html`.
- **TypeScript Entry:** `apps/admin/src/main.tsx`.
- **Router:** `apps/admin/src/router.tsx`.
- **Port:** 5174.
- **Directory Layout:**
  - `src/api/`: Typed API client querying Fastify `/v1/admin/*` endpoints.
  - `src/auth/`: `AdminAuthProvider` managing `fp_admin_sid` session cookies.
  - `src/components/`: Layout, navigation bars, role-gating wrappers (`RoleGate`).
  - `src/pages/`:
    - `login/`: Admin credentials and OTP authentication.
    - `merchants/`: Merchant search, detail view, KYC document inspection, bulk KYC approval bar.
    - `credits/`: Credit request queue, dual-control approval dialog.
    - `adjustments/`: Manual balance adjustments, CSV batch import uploader.
    - `settlement/`: Settlement batch runner, balance cache rebuild button, analytics rebuild.
    - `webhooks/`: Emergency webhook batch replay interface.

---

## 3. Key Administrative Workflows & Invariants

### 1. Admin Authentication & Role Gating
- Admin login requires credentials + OTP, setting `fp_admin_sid`.
- UI gates buttons and navigation based on `adminUser.role`:
  - `support`: Read-only views, webhook replays, impersonation, small credits.
  - `finance`: Settlement batch runs, balance rebuilds, credit issuance/approval, adjustments.
  - `super_admin`: Full platform control, bulk KYC, API key rotation.

### 2. Dual-Control Credit Queue (`/credits`)
- Requests for credits > 50.000 BD (50,000 fils) are placed in `credit_requests` with status `'pending'`.
- The approval dialog enforces that the approver is a **distinct administrator** (`BUG-040`):
  - Evaluates `created_by !== currentAdmin.id` using UUIDs.
  - The creator cannot approve their own credit request.

### 3. Balance Adjustments & CSV Import (`/adjustments`)
- Single-merchant adjustment form: submits delta and audit explanation.
- CSV import tool: parses amounts in BHD with 3 decimal places (`4.750 BD = 4750 fils`), resolving the 10x division defect (`BUG-009`).

### 4. Admin Impersonation ("View as Merchant")
- Clicking "View as Merchant" on a merchant detail page calls `POST /v1/admin/merchants/:id/impersonate`.
- Receives an impersonation token stored in cookie `fp_impersonation`.
- Opens `http://localhost:5173/dashboard` in a new tab (`BUG-083`).
- Impersonation is strictly read-only; mutation endpoints reject impersonators.

---

## 4. Existing Tests & Verification

- Build verification:
  ```bash
  npm.cmd run build -w @filspay/admin
  ```
- Fastify route tests covering admin features: `apps/api/src/routes/admin*.test.ts`.

---

## 5. Known Defects & Limitations

1. **Form State Retention Across Navigation (BUG-056):** When switching between merchant detail pages, form inputs can retain state from the previously viewed merchant.
2. **Bulk KYC Tab Selection Leak (BUG-078):** Bulk selection checkboxes retain hidden selections across tab changes.
3. **Balance Rebuild Source (BUG-011):** The UI button "Rebuild cached balances" invokes a query over scheme gross lines rather than the double-entry ledger.
