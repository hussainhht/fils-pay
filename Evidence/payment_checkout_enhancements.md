# Payment checkout enhancements

Date: 2026-10-30 (Asia/Riyadh). Baseline HEAD:
`1c3f99e0c5478e1ff616898cdfc1cd6f5283172d`. Initial working tree was clean.
No commits, branch changes, merges, schema changes, protected-money changes or
settlement changes were made.

## Delivered scope and provider blocker

The existing public checkout is **`/pay/:token`**, not `/checkout/:token` as
older context documents claimed. Its public API remains
`GET /v1/payment-links/:token` and `POST /v1/payment-links/:token/pay`.

Implemented:

- Immediate Visa, Mastercard (51–55 and 2221–2720), and American Express
  detection using the existing range helper. Local SVG brand marks appear
  inside the input, all three appear when empty, and other networks get a
  generic card icon and an explanatory hint. Detection never authorizes a payment.
- Numeric card entry with network grouping (including Amex 4-6-5), Luhn and
  network-length checks, digit-anchored cursor/selection, formatted/unformatted
  paste, middle editing and separator deletion. Mobile input-only deletion
  events are handled. Overlong PANs remain visible and invalid rather than
  being silently truncated into another number.
- MM/YY expiration entry, MM/YYYY paste/autofill support, month validation and
  expired-card rejection. The current month remains valid until its end.
- Masked CVV/CVC, exact three-digit validation or four digits for Amex,
  network-specific hints, numeric keyboard and card autofill attributes.
- Labels, described inline errors, invalid states, first-error focus, keyboard
  tab order, accessible loading/errors, and responsive green/neutral styling
  based on existing tokens. The original page workflow and financial display
  remain intact; the card section is extracted into `CardPaymentForm`.
- Synchronous double-submission guards. Unknown network/5xx/processing outcomes
  retain the exact key and input in page memory and disable editing for recovery.
  A definitive 402 permits a fresh attempt. Success and terminal states unmount
  the form. Token changes remount all checkout state. Client `submittedAt` is
  no longer sent; server expiry remains authoritative.
- Active pages stop admitting new attempts at the link deadline, with a second
  check immediately before submission. An already-bound attempt can still be
  resumed using the same key, matching existing server behavior.

**Saved payment methods are blocked by the current integration.**
`apps/api/src/acquirer/types.ts` exposes only `authorize`, `capture` and `refund`;
`simulator.ts` is an in-process test acquirer. There is no hosted-field SDK,
tokenization, vault, customer identity/session, saved-method ownership model or
saved-method table/routes. Existing authentication identifies merchant staff or
admins, not the cardholder. The simulator does not define live network acceptance.

Therefore no saving checkbox, fake tokenization, local raw-card storage or
saved-method endpoints were added. The UI honestly states that saving is
unavailable. This follows the request's explicit fallback for providers without
secure tokenization. No consent can be collected for a working vault operation
that does not exist.

Enabling saving requires a real provider's hosted fields/tokenization and vault,
verified cardholder identity, consent records, owner-scoped list/delete APIs,
provider references and safe display metadata only, and authentication for each
future charge. That work needs an approved provider integration and schema/API
design. This delivery is a verified **sandbox checkout enhancement**, not a
claim of live-processing or PCI DSS compliance.

## Architecture and integrity inspection

Reviewed relevant context, `docs/ARCHITECTURE.md`, ADR 0001, the documented ADR
conflicts in `context/DECISIONS.md`, checkout source/API types, public routes,
payment-link read/pay/create/status, authorization/capture behavior and simulator
interfaces. Read `Evidence/agent-3-payments-checkout.md` and BUG-005/006 reports
as historical leads and checked current source before acting. Did not read
`Evidence/old-agints-instration/`.

Current `pay.ts` binds one payer/key/request durably before provider operations;
another payer cannot reclaim a reserved link after a timeout. Current server
expiry uses server time and ignores public `submittedAt`. These existing fixes
were preserved. Earlier context still described obsolete timeout reclamation;
the affected payment-flow documentation now matches the current source.

The UI sends only the existing normalized card shape. No new API contract,
provider operation, authentication bypass, financial write, analytics/logging,
browser storage or third-party card-data request was introduced. The API still
controls authorization, reservations, idempotency, ledger/outbox and settlement.
The existing raw simulated-card boundary was retained only for test cards.
No real payment calls were made.

ADRs 0003/0004/0006 and HANDOVER accounting conflicts remain open human policy
questions; this work does not resolve or rely on them for new financial logic.
Proposed/paused ADR 0005 was not implemented. `DEPENDENCY_MAP.md` was reviewed:
the web → existing API/money relationships are unchanged. No shared interface
changes require a downstream implementation.

## Environment and actual verification

- Windows PowerShell; Node 22.23.2, npm 10.9.8; installed Microsoft Edge for CDP.
- Go is 1.23.1, below the documented 1.24 prerequisite. Go work was not attempted.
- Docker CLI exists, but daemon/config access is denied in this shell. The
  existing local services were already running, so no infrastructure was started.
- Checked config file presence and environment-variable presence without
  printing configured secret values. Local DB connection settings were read
  into process memory from the existing compose config and restricted to loopback.
- Local ports 3000, 5173, 5174 and 5432 reachable. API `/healthz` and `/readyz`
  both HTTP 200; a real PostgreSQL query succeeded (PostgreSQL 16.15) and required
  tables were present. Both frontend public API probes returned the expected 404
  for an invalid payment link. No migration or destructive seed was run.

| Command/check | Actual outcome |
|---|---|
| `npm.cmd run test -w @filspay/web` | PASS: 50 tests, 0 failures; 12 new card-input tests |
| `npm.cmd run typecheck` | PASS: all workspaces, DB and scripts |
| `npm.cmd run build -w @filspay/web` | PASS: Vite production bundle, 78 modules |
| `git -c safe.directory=<workspace> diff --check` | PASS, exit 0; only line-ending normalization notices |
| `node --import tsx --test --test-reporter=spec apps/api/src/routes/paymentLinks.test.ts apps/api/src/acquirer/simulator.test.ts` with local `DATABASE_URL` | PASS, exit 0; existing real-DB payment-link suite and deterministic simulator tests |
| `node --import tsx apps/web/scripts/checkout.browser.test.mjs --baseline` | Expected FAIL: original page leaves an open expired link's form visible |
| Same browser command with `--baseline --retry-only` | Expected FAIL: original page generates a different key after a 502 |
| `node --import tsx apps/web/scripts/checkout.browser.test.mjs --live` | PASS: 15 UI verification groups plus one real local API/Postgres simulator checkout |
| Visual inspection of desktop, mobile and small-mobile screenshots | Readable fields, contained logos, two-column expiry/CVV, clear button and no horizontal overflow |

The browser regression harness reads baseline `HEAD` into a temporary sibling
module without overwriting an existing file; it removes only the file it created.
It does not switch, commit or modify tracked baseline source. Normal UI/error
checks intercept explicit sandbox fixture responses. The separate `--live` case
does not intercept payment-link requests: the browser uses Vite's proxy to the
running API and the real local database. The resulting link was paid, its
transaction captured 4,750 fils, and the ledger legs summed to zero.

Tests insert their own labeled local test fixtures. They do not truncate, delete
financial history or use real customer data. Test rows are retained. The script
closes its owned browser; existing API/web/admin services are left running.

Initial restricted-shell tests failed before test execution because tsx could
not read Windows account information (`uv_os_get_passwd`); the initial build
failed because esbuild could not read parent-directory metadata. Approved runs
outside that restriction passed. A noncanonical direct root invocation of web
tests produced 47/49 passes and two `React is not defined` errors in unchanged
`CheckoutFrame.tsx`, due to the root TSX configuration. The canonical workspace
command loads the web JSX configuration and passes all 50 tests. No tests or
assertions were skipped, disabled or weakened.

## Requested test coverage

| Requested case | Evidence/result |
|---|---|
| 1. Visa | Unit detection/length/Luhn/grouping and browser normalized submission PASS |
| 2. Mastercard / 2-series | Boundary unit cases 2221/2720 and exclusions 2220/2721, browser logo update PASS |
| 3. Amex | Unit/browser 15-digit 4-6-5 grouping, four-digit CVV error PASS |
| 4. Unknown/unsupported | Generic indicator, validation and processor-acceptance hint PASS; no promise of live acceptance |
| 5. Paste/deletion | Unit caret/selection and native browser input, separator deletion, mobile input-only deletion PASS |
| 6. Expired card | Invalid months/past month/current-month boundaries in units; browser blocks request and focuses expiry PASS |
| 7. CVV length | Exact 3/4 digits, numeric checks, masked field and hints PASS |
| 8. Save consent | Unavailable message/no misleading checkbox verified; vault-consent behavior BLOCKED by absent provider/identity |
| 9. Tokenized saving | NOT IMPLEMENTED / NOT RUN: no tokenization/vault |
| 10. Retrieval/ownership | NOT IMPLEMENTED / NOT RUN: no cardholder auth or saved-method API |
| 11. Deletion | NOT IMPLEMENTED / NOT RUN: no saved-method API |
| 12. Failed tokenization/declines | Tokenization BLOCKED; simulator tests, browser 402, 502/500/409 and lost-connection recovery PASS |
| 13. Mobile/desktop | Installed Chromium at 1280, 390 and 320px widths; no overflow, >=44px controls, screenshots PASS; physical devices NOT RUN |
| 14. Expired link | Baseline failure then browser success, pre-submit check and existing DB-backed 410 test PASS |

Additional browser checks: two submissions in the same JavaScript turn produce
one POST; card data is stripped of spaces before submission; no extra save/clock
fields are sent; success removes inputs; declined attempts get a new key;
uncertain attempts keep identical key/payload with readonly inputs; paid/canceled/
processing links have no payment form; numeric/autofill/label attributes and
keyboard order are correct; checkout makes zero auth calls and produces no
uncaught browser exceptions.

## Before/after findings

| Local ID | Severity | Before | After | Proof |
|---|---|---|---|---|
| CHECKOUT-01 | P2 | `confirmed-current`: open page remained active past expiry | `fix-verified` | Same browser expiry assertion fails on HEAD and passes on enhanced checkout |
| CHECKOUT-02 | P2 | `confirmed-current`: new retry key cannot resume server-bound payment | `fix-verified` | Baseline retry assertion fails; same-key network/5xx/processing recovery passes |

Scoped current-status counts: `historical-report` 0; `confirmed-current` 0;
`already-fixed` 0; `duplicate` 0; `stale-or-invalid` 0; `unverified` 0;
`fix-verified` 2. These counts cover the two findings above, not a repository-wide
reassessment of BUG-001…BUG-086. New card-entry capabilities are features, not
additional historical bug fixes. Saved-card support remains a feature blocker.

## Files changed

- `apps/web/src/pages/checkout/CheckoutPage.tsx`: existing workflow, expiry,
  synchronous request guard and same-key recovery, card-form integration.
- `apps/web/src/pages/checkout/CheckoutPage.css`: bounded responsive form styling.
- `apps/web/src/pages/checkout/CardPaymentForm.tsx`: real card-entry behavior and
  accessible validation; no save or storage operation.
- `apps/web/src/pages/checkout/cardInput.ts`, `cardInput.test.ts`: normalization,
  caret/deletion helpers, network lengths, validation and unit coverage.
- `apps/web/src/pages/checkout/CardBrand.tsx`, `card-brands/{visa,mastercard,amex}.svg`,
  `card-brands/LICENSE`, `card-brands/README.md`: local licensed network imagery
  and provenance. No runtime npm dependency was added.
- `apps/web/scripts/checkout.browser.test.mjs`: opt-in browser regression/live harness.
- `Evidence/implementation/checkout-{desktop,mobile,small-mobile}.png` and this report.
- `context/FRONTEND.md`, `PAYMENT_FLOWS.md`, `modules/apps-web.md`,
  `ARCHITECTURE.md`, `TESTING.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`: current
  behavior, corrected route/claim documentation and verification limits.

Brand range/grouping references:
[Visa card-input guidance](https://design.visa.com/patterns/card-input/) and
[Braintree's maintained card metadata](https://github.com/braintree/credit-card-type/blob/main/src/lib/card-types.ts).
Visa lengths use the union of those references (13, 16, 18, 19). SVGs are from
[SVG Credit Card & Payment Icons](https://github.com/aaronfagan/svg-credit-card-payment-icons),
unmodified, with the Apache 2.0 license retained. Static logos load locally, not
from an external host during checkout.

## Screenshots and remaining verification

Screenshots use explicitly intercepted sandbox UI data and empty card fields:
[desktop](implementation/checkout-desktop.png),
[390px mobile](implementation/checkout-mobile.png),
[320px mobile](implementation/checkout-small-mobile.png).

Manual follow-up for a tester: run the local stack and browser harness, then
open a test payment link; type/paste the documented simulator cards with a future
expiry, edit a middle digit, backspace across a space and a slash, switch between
Visa and Amex and check CVV hints, tab through fields, and leave a short-lived
link open until expiry. Use `4242 4242 4242 4242` for approval, or the existing
simulator test PANs in `simulator.test.ts` for deterministic decline/error cases.
Never use real card data. The automated checks above already exercise these
core behaviors; human screen-reader speech and physical iOS/Android keyboard,
clipboard and autofill behavior remain to be checked.

Other limits: no real provider sandbox, 3DS/customer challenge, production PCI
assessment, saved-method flows, broader password/OTP/admin-role journeys,
settlement/reporting workers or full monorepo/Go suites were verified here.
The original simulator's process-local provider idempotency limitation remains.
Recovery keys and card values are intentionally memory-only: refreshing or
closing the page loses local recovery and the server may continue to show
processing. A production recovery design needs a provider-backed status/identity
flow; raw card/CVV persistence is not a remedy. No production deployment was made.
