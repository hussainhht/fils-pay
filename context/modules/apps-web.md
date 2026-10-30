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
- `CardPaymentForm.tsx` owns numeric input, digit-anchored caret/selection, separator deletion (including mobile input-only events), inline Luhn/length/expiry/CVV validation and masked CVV. Visa, Mastercard (including 2221?2720) and Amex use local licensed SVGs; other numbers receive a generic card indicator.
- Open active links expire locally while the server remains authoritative. Existing bound attempts can be retried after the link deadline.
- Checkout is explicitly simulator-only. No provider tokenization/vault or cardholder identity exists; card saving is unavailable and no consent checkbox or saved-card endpoints are exposed.
- On submit, calls `POST /v1/payment-links/:token/pay`.
- A synchronous submission guard prevents duplicate requests. Uncertain network/5xx/processing responses freeze the entered values in memory and reuse the exact payload/key; a definitive 402 allows a fresh attempt. Success/terminal states remove the form. Route-token changes remount all state.
- The current server uses a durable payer/key/request claim; timeout does not allow another payer to reclaim it (older context described an obsolete timeout lock).

### 3. Financial Display Formatting
- **Invariant:** Never use `toFixed(2)` on monetary figures.
- Use `formatBhd(fils)`:
  - Formats integer fils as `X.YYY`; dashboard/checkout append `BHD` (e.g. `4750 fils` $\rightarrow$ `4.750 BHD`).

### 4. Merchant Payment-Link Amount Entry
- `pages/payment-links/PaymentLinkCreatePage.tsx` accepts BHD text rather than raw fils. `BhdAmountInput.tsx` uses a decimal-keyboard text input, retains accepted edits and native caret/selection, rejects invalid insertions/pastes and restores selection for non-cancellable input events.
- Drafts permit one period and up to three fractional digits, including empty text, `.`, `1.` and `0.`. No formatting happens during typing; complete safe amounts normalize to three decimals on blur/submit. Empty/lone-period drafts cannot submit.
- `bhdAmount.ts` completes strings and delegates exact conversion to the existing `parseBhdToFils`. The page requires positive safe-integer fils and preserves metadata/auth behavior. No floats or rounding, money-package modifications or added dependencies.
- `ExpirationInput.tsx`/`.css` provide native single-choice radios (15 Minutes, 24 Hours default, 7/30/90 Days, Custom Duration), green selection/focus and responsive controls. `expiration.ts` validates custom whole minutes/hours/days against inclusive 900..10368000 seconds. Presets ignore hidden custom values; invalid drafts disable creation. The estimated preview explicitly names Asia/Bahrain (UTC+03:00), refreshes every 30 seconds and on selection edits, and is never submitted. `CreatePaymentLinkInput` is an exactly-one-of union for legacy `expiresAt` or server-relative `expiresInSeconds`; the dashboard sends the latter.
- See `Evidence/features/features.md` (FEAT-003) for grammar, limits and actual verification.

---

## 5. Existing Tests & Verification

- `src/dashboard.test.ts`: Unit tests for formatting and mock data.
- `src/ui-accessibility.test.ts`: Accessibility checks.
- `src/pages/checkout/cardInput.test.ts`: network/range, formatting/caret/deletion, Luhn, expiry, CVV and payload tests.
- `src/pages/payment-links/bhdAmount.test.ts`: draft grammar, intermediate states, normalization, exact fils and safe-integer boundary tests.
- `src/pages/payment-links/expiration.test.ts`: presets/hidden drafts, custom units/bounds/precision and timezone-independent preview tests.
- `scripts/paymentLinkAmount.browser.test.mjs`: installed-Chromium decimal/caret/paste/mobile/keyboard, expiration options and creation-payload checks. Current result: 14 mocked groups; `node --import tsx ... --live` adds one real password/OTP-to-creation/database group using temporary API/Vite servers and a migrated local `filspay_expiration_test_<digits>` database specified by `DATABASE_URL`. No test fixture seeding/truncation; fixture inserts stay in the isolated DB. `--baseline` now fails on HEAD `850504a`'s missing expiration radios. Current web suite: 59 passing tests. Physical mobile devices remain unverified.
- `scripts/checkout.browser.test.mjs`: opt-in installed-Chromium UI checks; `--live` adds a simulator payment through localhost API/Postgres using new test fixtures. `--baseline` and `--baseline --retry-only` reproduce the two baseline regressions. See `Evidence/payment_checkout_enhancements.md`.
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
