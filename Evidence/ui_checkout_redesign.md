# Checkout UI redesign — 2026-10-30

Baseline HEAD: `2ee8df0a691e0bc0fe3624b4aa40e90f20d87617`.
Scope: frontend presentation only. User subsequently requested no further testing; no additional test runs were started after that instruction.

## Implementation and reasons

- `apps/web/src/pages/checkout/CheckoutPage.css`: replaced the narrow card with a centered 1056px, 22px-radius container, 62/38 desktop columns, mint summary, shared green tokens and system font, stronger amount hierarchy, 56px controls, visible focus/pressed/disabled/error styles and reduced-motion support. Below 800px, form precedes summary. Mobile padding is reduced below 480px.
- `CheckoutFrame.tsx`: reusable branded header, neutral “Payment checkout” label with decorative lock, optional order-summary sidebar and larger result icons. No certification, encryption or production-security claims.
- `CheckoutDetails.tsx`: reusable dynamic merchant identity, order summary, three neutral information rows, lightweight inline SVG illustration and expanded native details/summary test section. Merchant, amount, description and reference are API data. All original test suffixes and behavior descriptions are preserved.
- `CheckoutPaymentForm.tsx`: extracted existing JSX and input callbacks to make presentation directly testable. Preserved required fields, number bounds, separate numeric month/year values, raw PAN value and existing brand hint logic. Added labels/grouping, placeholders, busy/status markup, spinner and accessible association to the payment error. CVV/PAN autocomplete is off; no persistence/logging added.
- `CheckoutPage.tsx`: retains fetch and submit logic and all payment-state decisions. Adds structured merchant/amount presentation, inline alert and success receipt showing merchant, returned amount, existing transaction ID and paidAt. Loading/not-found/paid/expired/canceled/processing/terminal branches receive consistent styling.
- `checkout.test.ts`: seven focused render/callback tests.
- `scripts/checkout-preview.mjs`: loopback-only screenshot fixture using existing Vite/React dependencies. Synthetic API middleware has no API proxy, acquirer or DB connection; request card values remain in memory and are never logged/persisted. `--before` serves the three original checkout source files from baseline HEAD without modifying the working tree.
- Context updated: `FRONTEND.md`, `modules/apps-web.md`, `PAYMENT_FLOWS.md`, `TESTING.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`.
- This evidence file: `Evidence/ui_checkout_redesign.md`.

No backend/API client, database, money package, routing, simulator or dependency changes. `DEPENDENCY_MAP.md` reviewed: no new inter-module dependency. No architecture/ADR decision was changed, so ARCHITECTURE/DECISIONS need no update. Current source contradicts old countdown/timeout-reclaim context; affected frontend descriptions and payment-flow example labeling were corrected.

## Functionality preserved

Submission handler matches baseline after CRLF normalization, including `{ card, submittedAt }`, per-action UUID idempotency key, existing retry behavior and HTTP status/error mapping. Git diff confirmed API client, backend, money and db unchanged. An initial literal source comparison failed solely because working-tree CRLF differs from Git LF; normalized comparison passed.

Required/min/max constraints and input values are unchanged. Native browser validation messages remain; CSS adds user-invalid danger borders. No new validation rules, PAN formatting, card-network algorithm, payment method or payment state was introduced. Failure/insufficient-funds responses retain existing generic decline wording. Existing test suffixes remain 0002 (do not honor), 0119 (insufficient funds), 0069 (error).

## Environment and commands actually run

- `git status --short`, `git rev-parse HEAD`: checkout tree initially clean. `.api-run.log` changed during the session from an existing external process; it was not edited, reverted or inspected for contents.
- Node v22.19.0, npm 10.9.3, Go 1.24.2 available. Docker executable absent. `DATABASE_URL` unset; `ops/.env.docker` absent. No secret values printed.
- `npm.cmd run typecheck -w @filspay/web`: passed.
- `npm.cmd run test -w @filspay/web`: final result **45/45 passed**, including seven new checkout tests. Earlier run before the final callback test was 44/44.
- `npm.cmd run typecheck`: full repository passed (including db/scripts). Final in-flight run completed after the user's stop-testing instruction; no further run started.
- `npm.cmd run build -w @filspay/web`: passed, 81 modules. Existing helper dynamic/static import chunk warning remains non-fatal.
- `node --import tsx --test apps/api/src/acquirer/simulator.test.ts`: **6/6 passed**, including approval and all three magic suffix scenarios.
- `node --import tsx --test apps/api/src/paymentLinks/pay.test.ts apps/api/src/paymentLinks/status.test.ts apps/api/src/paymentLinks/serialize.new.test.ts`: **13/13 passed**, covering server-time expiry, derived public status and serialization.
- Lint: **not run**; no lint script exists in root or web package. No new lint dependency/configuration added.
- `node scripts/checkout-preview.mjs`: started on `http://127.0.0.1:5175`. HTTP requests verified the app HTML, CSS and Vite-transformed checkout module return 200. The first module request exceeded a 3-second timeout; subsequent request with a 30-second timeout returned 200.
- Fixture GETs: active/expired/paid/canceled/processing returned 200 with corresponding status; invalid returned 404. This is fixture verification, not actual backend payment execution.
- Existing local API `GET /healthz` and `GET /readyz`: both 200. No server was started/restarted and no real DB query was performed; readyz is not proof of current database reachability.
- Browser inventory attempt: no browsers/apps available; browser access host unavailable and native pipe absent. No screenshots or browser interaction were possible.

## Manual verification and screenshots

**Not performed:** actual browser visual review, keyboard tab/focus/native-validation interaction, desktop/mobile layouts at 375/768/1024/1440, user-driven approved/declined/insufficient-funds/error/loading/success journeys, actual screenshots. React render/callback tests are not substitutes for these checks.

Ready-to-capture fixture (synthetic data only):

1. After desktop: run `node scripts/checkout-preview.mjs`, open `http://127.0.0.1:5175/pay/preview` at 1440px.
2. Success: same page, enter a synthetic non-magic test PAN and a test CVV, keep valid expiry, submit; screenshot the receipt. The reference `preview-transaction-001` is fixture-only, never a fabricated production transaction.
3. Declined: open `/pay/declined`, enter synthetic test details, submit. `/pay/error` gives temporary-acquirer feedback. On `/pay/preview`, suffixes 0002/0119/0069 select their existing response categories; the UI intentionally retains generic decline wording for 0119.
4. Mobile: `/pay/preview` at 375px; also inspect 768/1024/1440 and check horizontal scrolling, labels, focus and touch targets.
5. Initial loading: `/pay/loading` delays details for eight seconds. Payment submission waits 1.5 seconds to capture the disabled processing button.
6. Unavailable states: `/pay/invalid`, `/pay/expired`, `/pay/paid`, `/pay/canceled`, `/pay/processing`.
7. Before: stop only the fixture server, rerun `node scripts/checkout-preview.mjs --before`, open the same URL at the same width. This reads original source from the recorded baseline without checkout/reset or overwriting current files. Before-mode server itself was not run in this session.

The fixture is a development tool, not a public/demo production route. Its synthetic outcomes do not prove payment correctness. Use seeded, explicitly authorized isolated local data for real end-to-end checks. No seed, migration, destructive command or real payment call was run here.

## Scope status and remaining limitations

This is a feature redesign, not a historical bug-fix pass. No BUG-001–BUG-086 status was changed; aggregate historical totals were not recomputed. No baseline failing regression is claimed for the new UI feature tests.

One existing source-confirmed issue recorded: **confirmed-current P2** — UI retry after an ambiguous 502 generates a new key, whereas backend recovery requires the original key/request. Before: confirmed-current; after: confirmed-current. Proof: CheckoutPage.handleSubmit generates crypto.randomUUID each attempt; paymentLinks/pay.ts retains ambiguous reservations bound to payment_key_hash/payment_request_hash. Left unchanged under the explicit payment-logic freeze. Runtime reproduction not performed.

Scoped issue counts: confirmed-current 1; historical-report 0; already-fixed 0; duplicate 0; stale-or-invalid 0; unverified 0; fix-verified 0. These counts cover the single scoped financial-flow finding, not the historical registry or visual-verification checklist.

Preserved legacy instruction “any other number approves” is qualified in practice by the simulator's configured random failure rate; simulator unchanged. Generic backend body.message handling and retry semantics remain as before. No financial ADR conflict was implemented or resolved.

Reference-image matching remains unverified: the supplied attachment directory contains only the written request, no image. The written visual brief guided implementation. Browser and isolated DB limitations prevent an end-to-end or pixel-match completion claim.
