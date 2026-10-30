# Module: `apps/web` (Merchant Portal & Hosted Checkout)

> **Scope:** Architecture, page components, routing, authentication flows, hosted checkout, and API client for the merchant frontend.

---

## 1. Purpose & Responsibilities

`apps/web` is a React 18 single-page application built with Vite providing:
1. **The Merchant Portal (`/dashboard/*`):** Self-service dashboard for merchants to monitor transactions, issue refunds, create payment links, view settlements, and configure webhooks.
2. **Hosted Checkout (`/checkout/:token`):** Public-facing cardholder checkout interface for executing single-use payment link payments.

---

## 2. Main Entry Points & Directory Layout

- **Vite Config:** `apps/web/vite.config.ts`.
- **HTML Entry:** `apps/web/index.html`.
- **TypeScript Entry:** `apps/web/src/main.tsx`.
- **Router:** `apps/web/src/router.tsx`.
- **Directory Layout:**
  - `src/api/`: Typed API client querying Fastify `/v1` endpoints with credentials.
  - `src/auth/`: `AuthProvider` context managing `fp_sid` session state.
  - `src/components/`: `DashboardLayout`, navigation sidebars, modals.
  - `src/format.ts`: `formatBhd(fils)` helper.
  - `src/pages/`:
    - `dashboard-login/`: 2-step credentials and OTP challenge screen.
    - `overview/`: KPI cards (gross volume, success rate, payable balance), recent transactions.
    - `transactions/`: Transaction search, status filters, detail modal, Refund drawer.
    - `payment-links/`: Link creation dialog, active/expired link tables.
    - `settlement/`: Batch list, batch detail, scheme export CSV downloads.
    - `webhooks/`: Webhook endpoint management, delivery log, test ping button.
    - `checkout/`: Consumer checkout payment form (`/checkout/:token`).
  - `src/refunds/`: `RefundDrawer` slide-over component.

---

## 3. Proxy Configuration & Development Port

- **Port:** 5173.
- **Upstream Proxy (`ops/preview.mjs`):** Proxies all `/v1` and `/healthz` requests to the Fastify API on `http://127.0.0.1:3000`.
- **Authentication Transmission:** Frontends use `credentials: "include"` so cookies (`fp_sid`, `fp_impersonation`) are attached automatically.

---

## 4. Key Workflows & Invariants

### 1. Two-Step Merchant Login
- User enters email and password $\rightarrow$ calls `POST /v1/auth/login`. Sets pending `fp_sid`.
- UI switches to OTP entry $\rightarrow$ calls `POST /v1/auth/otp/verify`.
- Session token is rotated on promotion (`BUG-016`); UI redirects to `/dashboard`.

### 2. Hosted Checkout Page (`/checkout/:token`)
- Rendered in isolation without the dashboard layout.
- Calls public `GET /v1/payment-links/:token` for amount and status.
- Displays expiration countdown and card input form.
- On submit, calls `POST /v1/payment-links/:token/pay`.
- If the reservation lock expires or is claimed concurrently, displays `409 Conflict` message (`BUG-006`).

### 3. Financial Display Formatting
- **Invariant:** Never use `toFixed(2)` on monetary figures.
- Use `formatBhd(fils)`:
  - Formats integer fils as `X.YYY BD` (e.g. `4750 fils` $\rightarrow$ `4.750 BD`).

---

## 5. Existing Tests & Verification

- `src/dashboard.test.ts`: Unit tests for formatting and mock data.
- `src/ui-accessibility.test.ts`: Accessibility checks.
- Build verification:
  ```bash
  npm.cmd run build -w @filspay/web
  npm.cmd run test -w @filspay/web
  ```

---

## 6. Known Defects & Limitations

1. **Document Title (BUG-085):** Dashboard pages incorrectly retained the title string "Checkout".
2. **Date Filtering (BUG-076):** Date pickers generated UTC midnight timestamps, cutting off the first 3 hours of Bahrain daily volume.
3. **Payment Links Pagination (BUG-077):** Link table was capped at 100 links with no pagination controls.
