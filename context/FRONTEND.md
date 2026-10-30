# Frontend Architecture & UI Reference — FilsPay

> **Scope:** Architecture, page hierarchies, component design, proxy configuration, formatting rules, and UI state management for `apps/web` and `apps/admin`.

---

## 1. Frontend Technology Stack & Topology

FilsPay provides two independent single-page React applications built with Vite:

| Application | Role | Base Port | Key Routes | Upstream Proxy Target |
|---|---|---|---|---|
| `apps/web` | Merchant Portal & Hosted Checkout | 5173 | `/dashboard/*`, `/checkout/:token` | `http://127.0.0.1:3000/v1` |
| `apps/admin` | Operations & Admin Console | 5174 | `/login`, `/merchants`, `/credits`, `/settlement` | `http://127.0.0.1:3000/v1/admin` |

### Dev Proxy Configuration (`ops/preview.mjs`)
Both frontends are orchestrated locally via `node ops/preview.mjs`, which starts Vite programmatic dev servers configured to proxy `/v1` and `/healthz` directly to Fastify on port 3000. Frontends rely on same-origin cookie transmission (`credentials: "include"`).

---

## 2. Merchant Portal & Checkout (`apps/web`)

### Directory Structure
```text
apps/web/src/
├── api/             # Typed API client functions querying Fastify /v1 endpoints
├── auth/            # AuthProvider, useAuth hook, session storage
├── components/      # Shared UI layout (DashboardLayout, Navbar, Sidebar, Modals)
├── format.ts        # BHD formatting (formatBhd), date helpers
├── pages/
│   ├── dashboard-login/    # 2-step password and OTP challenge form
│   ├── overview/           # Dashboard KPIs, payable balance card, recent transactions
│   ├── transactions/       # Transaction table, search filters, detail modal, Refund drawer
│   ├── payment-links/      # Link creation dialog, active/expired link tables
│   ├── settlement/         # Daily batch list, settlement breakdown, CSV download
│   ├── webhooks/           # Endpoint registration, secret display, delivery logs, test ping
│   └── checkout/           # Public customer checkout form (/checkout/:token)
├── refunds/         # RefundDrawer component (FP-212)
└── router.tsx       # React Router 6 route definitions
```

### Key UI Workflows & Features
1. **Authentication Flow:**
   - Navigating to `/dashboard` redirects to `/dashboard/login` if unauthenticated.
   - Screen 1: Email + Password. Upon success, stores pending state and displays OTP challenge.
   - Screen 2: 6-digit OTP code entry. Upon verification, session cookie `fp_sid` is marked active and user is routed to `/dashboard`.
2. **Hosted Checkout (`/checkout/:token`):**
   - Independent of merchant dashboard shell; displays cardholder payment interface.
   - Queries `GET /v1/payment-links/:token` for amount and status.
   - Submits payment to `POST /v1/payment-links/:token/pay`.
   - Displays loading, processing, success and unavailable states. No reservation countdown is implemented; the backend retains ambiguous reservations for same-key recovery.
3. **Refund Drawer:**
   - Slide-over panel on transaction detail view allowing merchant owners and finance users to issue full or partial refunds.
   - Validates that refund amount does not exceed captured headroom.

### Frontend Invariants & Gotchas
- **BHD Money Formatting:** Always use `formatBhd(fils)` (`format.ts`). Renders as `X.YYY BD` (e.g. `12.500 BD`). Never use `toFixed(2)`.
- **Date Filters (BUG-076):** Transaction search and date filters must convert selected dates to **Asia/Bahrain** local midnight, not UTC midnight, to avoid dropping the first 3 hours of activity.
- **Document Title (BUG-085):** Ensure dashboard pages set appropriate titles (`FilsPay Merchant Portal`) rather than default checkout strings.

---

## 3. Operations Console (`apps/admin`)

### Directory Structure
```text
apps/admin/src/
├── api/             # Admin API client functions querying Fastify /v1/admin
├── auth/            # AdminAuthProvider, admin session state
├── components/      # AdminLayout, Navigation, RoleGate, ApprovalDialog
├── pages/
│   ├── login/       # Admin credentials and OTP login screen
│   ├── merchants/   # Merchant directory, detail view, KYC review, bulk actions
│   ├── credits/     # Credit requests queue, approval/rejection modal
│   ├── adjustments/ # Balance adjustments form, CSV file import
│   ├── settlement/  # Settlement batch run trigger, balance rebuild, analytics rebuild
│   └── webhooks/    # Emergency webhook batch replay interface
└── router.tsx       # Admin route configuration
```

### Key Administrative Capabilities
1. **Merchant KYC Review & Bulk Approval:**
   - Detail view inspects uploaded business registration and identity documents.
   - Bulk KYC approval bar allows super admins to approve multiple merchants currently in `under_review` state (`BUG-042`).
2. **Two-Person Rule Credit Queue (`/credits`):**
   - Support and finance admins can draft credit requests.
   - Any request exceeding 50.000 BD (50,000 fils) is held in pending status until a distinct second administrator signs off (`BUG-040`).
3. **Balance Adjustments & CSV Import (`/adjustments`):**
   - Single-merchant manual balance adjustments.
   - CSV bulk adjustment uploader: parses amounts in BHD with 3 decimals (`4.750 BD = 4750 fils`), resolving the 10x reduction bug (`BUG-009`).
4. **"View as Merchant" (Impersonation):**
   - Clicking "View as Merchant" on a merchant detail page generates an `fp_impersonation` cookie and redirects the browser to `http://localhost:5173/dashboard` (`BUG-083`).
   - The UI displays a persistent top banner indicating active impersonation mode with an "Exit Impersonation" action.
   - Write actions inside the dashboard are disabled or blocked by server-side `403 Forbidden` checks.

### State Management & Navigation Risks
- **Form State Retention Across Navigation (BUG-056):** When switching between merchant detail pages, form inputs must reset explicitly via `useEffect` keys to avoid submitting data against the wrong merchant ID.
- **Filter State Isolation (BUG-078):** Bulk selection checkboxes must clear when tabs or filter parameters change to prevent approving unintended merchants.
- **Progress Ratio Scaling (BUG-082):** Progress indicators must divide fils by 1,000 (not 10,000) when calculating percentages against BD targets.

## Authenticator UI (2026-10-30)

Shared apps/ui/AuthenticatorSetup.tsx and authenticator.css provide Account security at /dashboard/security and /security, linked from each authenticated shell. Setup uses a locally generated PNG QR, optional manual key, new-code confirmation and one-time recovery-code display with explicit save acknowledgement. Secrets remain in component memory only; no localStorage, external QR service or secret-bearing URL. Replacement requires fresh password and old-factor/recovery proof. Login pages consume verificationMethod, show authenticator instructions/recovery toggle, and hide merchant email resend for TOTP. Microsoft Authenticator uses Other account; no Entra/push flow exists. Build/static correctness verified; actual device scan/interactive visual review remains unverified.

## Hosted checkout presentation (2026-10-30)

CheckoutFrame composes the existing Brand header, form/result region and optional CheckoutSummary sidebar. CheckoutDetails supplies dynamic merchant/order information, neutral simulated-payment wording, inline SVG illustration and expanded native test-card disclosure. CheckoutPaymentForm retains the original four inputs, native required/min/max validation, card state callbacks and brand hint; month/year remain separate. Scoped CheckoutPage.css uses shared tokens, a 1056px desktop container and a single column at 800px and below. Busy submission and inline error alerts are exposed accessibly; native browser validation messages remain in use. Success shows API merchant, returned amount, transaction ID and paidAt. No API, routing, financial or database behavior changed. Browser screenshots and 375/768/1024/1440 layout/keyboard verification remain unverified because the browser host is unavailable.
