# Module: `apps/web` (Merchant Portal & Hosted Checkout)

> **Scope:** Architecture, page components, routing, authentication flows, hosted checkout, and API client for the merchant frontend.

---

## 1. Purpose & Responsibilities

`apps/web` is a React 18 single-page application built with Vite providing:
1. **The Merchant Portal (`/dashboard/*`):** Self-service dashboard for merchants to monitor transactions, issue refunds, create payment links, view settlements, and configure webhooks.
2. **Hosted Checkout (`/pay/:token`):** Public-facing cardholder checkout interface for executing single-use payment link payments.

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
    - `checkout/`: Consumer checkout payment form (`/pay/:token`).
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

### 2. Hosted Checkout Page (`/pay/:token`)
- Rendered in isolation without the dashboard layout.
- Calls public `GET /v1/payment-links/:token` for amount and status.
- Displays card inputs and server-derived public status; there is no frontend expiration countdown.
- On submit, calls `POST /v1/payment-links/:token/pay`.
- Competing payers receive a `409 Conflict` message. Ambiguous reservations remain bound to the original key/request, including after timeout; the UI currently creates a fresh key per retry.

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

## Checkout redesign verification (2026-10-30)

Presentation split across CheckoutFrame, CheckoutDetails, CheckoutPaymentForm and scoped CSS; CheckoutPage still owns fetching, card state, submission and payment-state branches. Input callbacks, raw PAN, numeric month/year conversion, request body and idempotency lifecycle are preserved. Seven checkout presentation tests cover dynamic escaped data/exact fils display, native validation attributes, submitting/declined markup, sandbox suffixes, result composition and input/submit callback forwarding. Web suite: 45/45 pass; production build and repository typecheck pass. Local-only scripts/checkout-preview.mjs serves the actual app with synthetic /v1 responses on loopback port 5175, without proxy/database access; --before loads the three original checkout files from baseline 2ee8df0. This fixture is not payment integration evidence. See Evidence/ui_checkout_redesign.md for capture instructions and limitations.

### Screenshot follow-up (2026-10-30)

Actual public route is /pay/:token (router.tsx); the fixture uses /pay/preview. Running Vite was observed returning an empty checkout CSS JavaScript module while ?direct contained CSS. Rewriting the stylesheet invalidated the stale transform; final HTTP checks inspect layout content, not just status. All checkout SVGs now have intrinsic dimensions to avoid oversized icons without CSS. New regression fails before missing dimensions and passes after. Web tests 46/46, build and repository typecheck passed. Browser appearance remains unverified.
