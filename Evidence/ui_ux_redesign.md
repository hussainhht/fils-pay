# FilsPay UI/UX redesign

Date: 2026-10-30 (Asia/Bahrain). Baseline HEAD: `e4cb706fc718ce1a13e3de0fb942ce3ea21fa168`.

## Scope and implementation

Implemented a shared green visual system for the existing merchant dashboard, operations console, authentication forms and checkout. No new routes, metrics, navigation destinations, dependencies or workflows were added. This is a local repository deliverable; nothing was published or committed.

- `apps/ui/tokens.css` defines the green palette, typography, surfaces, borders, radius, shadow and focus treatment. System fonts avoid external font requests.
- `apps/ui/console.css` provides reusable merchant/admin styling. The original stylesheet entry points import it, preserving existing class names and component architecture.
- Navigation uses clear active backgrounds, wrapping links, touch-sized targets and named navigation landmarks. Both authenticated shells have a skip-to-content link and focusable main target.
- Login forms use restrained white panels, a green brand edge, consistent field labels and spacing. Existing credential/OTP state, validations and actions are preserved.
- Filters, forms, buttons, detail lists, notices, confirmation panels and empty table rows have consistent styling. Successful, pending, failed and neutral states retain distinct colors and text labels. The impersonation banner remains prominent red with a yellow edge.
- Data tables retain native table semantics inside named, focusable regions with horizontal scrolling. Financial values use right alignment and tabular numerals. Long identifiers wrap; detail lists stack on narrow screens.
- Checkout has matching typography, green payment action, amount hierarchy, responsive card fields, error treatment and receipt/detail styling. All existing simulated-acquirer guidance and payment behavior are retained.
- Shared layout uses logical CSS properties where appropriate. No new language or RTL workflow was introduced.

Surfaces covered by shared styles: merchant transactions/refunds, payment links, webhook configuration, settlement, reconciliation and reporting overview; admin merchants, credits, settlement operations, adjustment imports and webhook replay; both sign-in/OTP flows; checkout loading, unavailable, active and result states. These are code-level coverage statements, not claims that every state was rendered.

## Verification

Environment: Windows PowerShell; Node `v22.19.0`, npm `10.9.3`, Go `1.24.2`. Initial working tree was clean. Dependencies were already installed. Docker was not found; `ops/.env.docker` was absent and `DATABASE_URL` was unset. No secret values were read or printed.

| Check | Real result |
| --- | --- |
| `npm.cmd run typecheck` | Passed across all workspaces, database tooling and scripts, including the new test file. |
| `npm.cmd run build -w @filspay/web` | Passed. Existing mixed static/dynamic import warning for `utils/helpers.ts`; no build failure. |
| `npm.cmd run build -w @filspay/admin` | Passed. |
| `npm.cmd run test -w @filspay/web` | Passed: 22 tests, 0 failures. Includes 13 new checks covering tables in both apps. |
| Baseline regression experiment | Executed the new table checks against source obtained with `git show HEAD:<path>`: all 13 checks failed, exit 1, as expected. Current source: all 13 pass. No checkout/reset was used. |
| TypeScript AST comparison against HEAD | All 13 table pages matched after excluding CSS class attributes, the added scroll wrappers and formatting whitespace. Initial exploratory checker versions flagged formatting artifacts; the corrected comparison passed. |
| `git diff --check` | Passed; Git emitted only Windows LF/CRLF notices. |
| `node ops/preview.mjs` | Could not start a second preview: port 5173 already in use. Existing servers were left running. |
| HTTP GET merchant `/dashboard/login` on 5173 and admin `/login` on 5174 | Both returned 200. This checks serving HTML, not rendering or successful API integration. |
| HTTP GET API `/healthz` and `/readyz` on 3000 | Unavailable. |
| Browser inventory through `cua.getState()` | Failed: native pipe and browser access host unavailable. No browser screenshots or visual inspection were possible. |
| Lint | Neither frontend defines a lint script; not run. |
| API/reporting integration tests and database query | Not run: no configured migrated Postgres or Docker. |

The regression suite inspects actual JSX ancestry and requires a named region with `tabIndex={0}` around every existing data table in both apps. It protects keyboard access to scroll containers but does not prove CSS layout, screen-reader behavior or browser scrolling.

## Before/after issue status

One local accessibility issue was tracked for this workstream, outside the historical BUG registry:

| Issue | Severity | Before | After | Proof |
| --- | --- | --- | --- | --- |
| UI-A11Y-001: data tables have no named keyboard-focusable scroll container | P3 | `confirmed-current` by inspection of baseline JSX | `fix-verified` at source/test level | 13 baseline failures; 13 current passes; shared overflow styling. Browser behavior remains unverified. |

Workstream status counts: `fix-verified`: 1; `historical-report`: 0; `confirmed-current`: 0; `already-fixed`: 0; `duplicate`: 0; `stale-or-invalid`: 0; `unverified`: 0. This is not an audit or reclassification of BUG-001 through BUG-086, and no count of remaining platform P0–P2 defects is asserted.

## Files changed by this workstream

- `apps/ui/tokens.css` (new)
- `apps/ui/console.css` (new)
- `apps/admin/src/admin.css`
- `apps/admin/src/components/AdminLayout.tsx`
- `apps/admin/src/pages/adjustments/AdjustmentImportPage.tsx`
- `apps/admin/src/pages/credits/CreditsPage.tsx`
- `apps/admin/src/pages/merchants/MerchantDetailPage.tsx`
- `apps/admin/src/pages/merchants/MerchantListPage.tsx`
- `apps/admin/src/pages/settlement/SettlementPage.tsx`
- `apps/web/index.html`
- `apps/web/src/components/DashboardLayout.tsx`
- `apps/web/src/dashboard.css`
- `apps/web/src/pages/checkout/CheckoutPage.css`
- `apps/web/src/pages/overview/OverviewPage.tsx`
- `apps/web/src/pages/payment-links/PaymentLinkListPage.tsx`
- `apps/web/src/pages/settlement/SettlementBatchDetailPage.tsx`
- `apps/web/src/pages/settlement/SettlementBatchListPage.tsx`
- `apps/web/src/pages/transactions/TransactionDetailPage.tsx`
- `apps/web/src/pages/transactions/TransactionListPage.tsx`
- `apps/web/src/pages/webhooks/WebhookEndpointDetailPage.tsx`
- `apps/web/src/pages/webhooks/WebhookEndpointListPage.tsx`
- `apps/web/src/ui-accessibility.test.ts` (new)
- `Evidence/ui_ux_redesign.md` (new)

Concurrent edits appeared in API test files during verification. Those were not edited, reverted or included in this workstream. There are no API shape, shared TypeScript interface, schema or money-package changes. Both UI apps depend on the new shared CSS files, which must be retained with the checkout.

## Limits and remaining review

No before/after screenshots were captured or fabricated. Desktop/mobile/tablet layout, keyboard interactions, actual overflow, dialogs, console errors and rendered contrast still need browser inspection when access is restored. The code includes responsive rules and focus treatment; these are not substitutes for visual QA.

Without the API/database, merchant password-to-OTP, admin sessions, role/tenant separation, onboarding/KYC, API keys, transaction/refund operations, reporting and settlement/payment state transitions were not exercised. No seed, migration, destructive database action or real payment call was made. Full end-to-end operation is not verified.

Existing backend limitations and financial questions remain outside this change. In particular, the settlement detail page already contains a gross-derived progress bar with no clearly documented progress meaning; it was not changed or supplemented with new financial metrics. ADR 0003/0004/0006 and handover conflicts remain human questions as directed by AGENTS.md; no new financial code was added and no decision was made about them.
