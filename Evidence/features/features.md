# FilsPay features

Product features, their current status, and what remains unavailable. Defects live in [bugs/Readme.md](../bugs/Readme.md). This file does not list them.

---

## FEAT-001 — Merchant refunds

**Ticket:** FP-300  
**Requested by:** Product  
**Was:** Never shipped. `POST /v1/refunds` answered `501 { "error": "not_implemented" }`. Helpers, the `refunds` table, and a dashboard drawer existed and were not connected.  
**Now:** Shipped behind `FEATURE_REFUNDS`. The Compose API service sets that flag. The code default in `apps/api/src/config.ts` stays off, so a deploy can turn the route back to 501 without a code change.

A merchant owner or finance user can return some or all of a captured payment. The same call writes the ledger, reverses the fee to the fil, reduces the next payout, tells the shop, and shows up on the timeline, the daily report, and reconciliation.

### What the merchant does

1. `POST /v1/refunds` or `POST /v1/merchants/:merchantId/refunds`.
2. Body: `{ transactionId, amountFils?, reason? }`. Leave `amountFils` out to refund whatever is still refundable.
3. Header: `Idempotency-Key`. The same key on a retry returns the same refund. A new key is a new attempt.
4. The merchant is the authenticated session or API key. A merchant id in the body is ignored. The path form must be that same merchant.

The dashboard drawer on the transaction page calls the same route. It is shown to owner and finance when `refundsEnabled` is true on `/v1/auth/me`, and only for `captured`, `partially_captured`, and `partially_refunded`.

### Who may refund

- The flag must be on. Off means 501.   
- Role is owner or finance.
- An admin impersonation grant is refused.
- `merchants.refunds_enabled = false` puts that merchant on hold (403). Unset means allowed.
- Another merchant's transaction is 404.

### Money

Amounts are integer fils. A refund cannot exceed what was captured and not yet refunded or reserved.

Each success posts a balanced ledger group:

- Debit `merchant_payable`, credit `card_scheme_clearing`, for the refund gross.
- If a fee is reversed: debit `platform_fee_revenue`, credit `merchant_payable`, for that fee.

Partial refunds each reverse their own share of the fee. The last refund, the one that returns the rest of the capture, reverses whatever fee is still outstanding, so the reversals add up to the fee that was charged.

### Payouts

`CloseBatch` still builds scheme lines and platform volume from captures only. In the same Bahrain business day it then subtracts succeeded refunds that no batch has claimed yet: gross loses `amount_fils`, fee loses the stored `fee_reversed_fils`. Those refunds are stamped with the batch id. A second close does not take them again.

A refund that happens after that day's batch is already closed or paid is not written back into the paid batch. It reduces the next open day. A day with only refunds can close with a negative net. No bank disbursement is recorded for a zero or negative net.

### What the shop sees

A successful refund enqueues one `refund.succeeded` outbox event. The webhook dispatcher can send it. The signature is over the same canonical body that is posted.

The transaction timeline records `refund_partial` or `refunded`. Reporting adds `refund_count` and `refund_gross_fils` on `merchant_daily_volume` for the Bahrain date. Reconciliation counts an unbatched refund in the pending net (`amount_fils` minus `fee_reversed_fils`), so the ledger, the closed batches, and the pending figure still meet. `refund_merchant_summary` counts each transaction's captured amount once per merchant per Bahrain day, and still sums every succeeded refund.

### Where it lives

| Piece | Path |
|---|---|
| Routes | `apps/api/src/routes/refunds.ts` |
| Hold and tenant check | `apps/api/src/refunds/initiateMerchantRefund.ts` |
| Ledger, fee, outbox | `apps/api/src/payments/processRefund.ts` |
| Drawer | `apps/web/src/pages/transactions/RefundDrawer.tsx` |
| Webhook type | `apps/api/src/webhooks/envelope.ts`, `apps/api/src/webhooks/dispatcher.ts` |
| Daily rollup | `apps/reporting/src/consumer/applyEvent.ts` |
| Close | `apps/settlement/internal/settlement/batch.go` |
| Reconciliation | `apps/api/src/settlement/query.ts` |
| Summary view | `db/migrations/0084_refund_merchant_summary_once.sql` |
| Flag | `FEATURE_REFUNDS` on the API service in `ops/docker-compose.yml` |

---

## FEAT-002 — Payment checkout enhancements

**Was:** A basic simulated-card form with a text brand hint, separate month/year fields, and limited client validation.

**Now:** Implemented for the existing simulated acquirer. Card entry, validation, responsive presentation, link expiry and payment retries are improved. Saved cards remain unavailable because the integration has no tokenization or vault and the application has no verified cardholder identity.

### What the payer does

1. Opens `/pay/:token`. The page reads the merchant name, amount, reference, description and link status from `GET /v1/payment-links/:token`.
2. Enters a test card number, expiration date and security code. The page formats the input and explains invalid fields inline.
3. Selects **Pay**. The checkout sends the existing card shape to `POST /v1/payment-links/:token/pay` with an `Idempotency-Key`. Spaces are removed from the number before submission.
4. Sees processing, decline, recovery or success feedback. A success shows the transaction id and payment time and removes the card form.

The checkout is public and stays outside merchant dashboard authentication. It is explicitly marked as a test checkout: use sandbox card details only; the simulator makes no real charges. Amounts still use the existing integer-fils formatting.

### Card brands and number entry

- Visa is recognized from prefix `4`.
- Mastercard is recognized from `51` through `55`, and the inclusive `2221` through `2720` range, including 2-series cards.
- American Express is recognized from `34` or `37`.
- Local SVG logos appear inside the number input and update as the payer types. An empty field shows all three logos. An unrecognized number gets a generic card icon and a message that acceptance is determined by the processor.
- Visa and Mastercard numbers are grouped in blocks of four. Amex uses `4-6-5` grouping for its 15 digits. Longer Visa numbers continue in four-digit groups, with a shorter final group where needed.
- Typing and pasting accept formatted or unformatted numbers and remove nonnumeric characters. Cursor and selection positions follow the digits when editing in the middle. Backspace/delete across generated spaces or the expiration slash removes the adjacent digit; mobile input-only deletion events are handled too.
- Overlong numbers stay visible and fail validation. They are not silently shortened into another card number.

Brand detection is a display hint. It does not authorize a transaction or promise that a live processor accepts a network. The current processor is a simulator.

### Validation, expiration and security code

Card numbers must pass Luhn and the detected network's length check: Visa accepts 13, 16, 18 or 19 digits; Mastercard 16; Amex 15. Unrecognized networks use a generic 12-to-19-digit Luhn check. Empty, incomplete, all-zero and invalid-checksum numbers are rejected by the form.

Expiration is formatted as `MM/YY`. Pasting or autofilling `MM/YYYY` is also supported. The month must be `01` through `12`; dates before the current month are rejected. A card expiring this month remains valid through the end of the month.

The security code is masked and must contain exactly four digits for Amex or three for the other detected/generic card types. The hint points to the front of an Amex card or the back of other cards. These enhancements add no card/CVV persistence or logging.

Errors appear next to the relevant field and are linked to its accessible label. Submitting an invalid new attempt focuses the first invalid field and sends no payment request. An existing uncertain attempt resends its unchanged details for server-side recovery rather than starting a new authorization.

### Submitting and retrying

The button is disabled while submitting, and synchronous guards prevent two submissions in the same turn from creating two requests. Inputs cannot be edited during submission.

After an uncertain network failure, server error or processing response, the page keeps the same key and exact card values in memory, locks the inputs and offers **Check payment / retry**. A definitive `402` decline allows editing and a fresh key for the next attempt. The server's existing authorization, reservation, ownership and financial checks remain authoritative.

An open active link stops admitting new attempts at its expiry, and submission checks the deadline again. New visits to paid, expired, canceled or already-processing links do not show a payment form. An attempt already bound by the server may resume under the same key after the deadline; this is recovery of that attempt, not a new payment.

Card values and the recovery key are kept only in page memory. Success or a terminal state removes the form, and changing the link token resets checkout state. Refreshing or closing the page loses local recovery; the server may continue to report processing. No browser storage was added to work around that limit.

### Saved cards

**Unavailable, not implemented.** The page says **Card saving is unavailable for this checkout.** There is no decorative consent checkbox or simulated saving presented as real.

The acquirer exposes authorization, capture and refund only. It has no hosted fields, tokenization or card vault. Merchant staff and admin sessions do not establish ownership of a payer's card. No saved-card list, selection, save or delete operation, payment-method reference storage or future-charge flow was added. Raw PAN/CVV storage is not a substitute for a provider vault.

Supporting saved cards needs provider tokenization/vault support, a verified cardholder identity, explicit consent, server-side ownership checks for retrieval and deletion, and the necessary authorization/customer authentication for future charges. Only provider references and safe display metadata should be stored. Saving must never grant permission for arbitrary future payments.

### Presentation and accessibility

The page keeps the existing checkout workflow and uses FilsPay's green design tokens, neutral surfaces, rounded inputs and subtle shadows. Expiration and security code share a responsive two-column row. Inputs and the payment button have clear focus, error, readonly and loading states; success uses the existing checkout frame's result decoration.

Fields have screen-reader labels and error descriptions, numeric keyboard hints and card autofill attributes. Keyboard order follows card number, expiration, security code and payment. Detected-network text is announced through a polite live region.

### Verification

The [checkout implementation report](../payment_checkout_enhancements.md) records 50 passing web tests, the passing workspace typecheck and web build, existing payment-link/acquirer tests, and 15 browser verification groups. A separate local browser → API → simulator → PostgreSQL checkout reached captured status with a balanced ledger. Baseline expiry and retry-key regression checks failed before the fixes and passed afterward.

Browser checks cover network indicators, paste/formatting/deletion, expiry and CVV errors, double submission, decline and uncertain-outcome retries, keyboard navigation and 1280px/390px/320px layouts. [Desktop](../implementation/checkout-desktop.png), [mobile](../implementation/checkout-mobile.png) and [small-mobile](../implementation/checkout-small-mobile.png) screenshots are available.

Saved-card consent/tokenization, retrieval/ownership, removal and future charges were not tested because those capabilities do not exist. Live-provider processing, 3DS, physical mobile devices and screen-reader speech remain unverified. This entry summarizes the recorded implementation verification; the documentation-only update did not rerun tests or change application behavior.

### Where it lives

| Piece | Path |
|---|---|
| Checkout workflow, expiry and retry key | `apps/web/src/pages/checkout/CheckoutPage.tsx` |
| Card form, inline errors and input behavior | `apps/web/src/pages/checkout/CardPaymentForm.tsx` |
| Formatting, caret/deletion helpers and validation | `apps/web/src/pages/checkout/cardInput.ts` |
| Existing network-range helper | `apps/web/src/utils/helpers.ts` |
| Brand rendering and licensed SVG assets | `apps/web/src/pages/checkout/CardBrand.tsx`, `apps/web/src/pages/checkout/card-brands/` |
| Checkout frame and styling | `apps/web/src/pages/checkout/CheckoutFrame.tsx`, `apps/web/src/pages/checkout/CheckoutPage.css` |
| Existing checkout API client | `apps/web/src/api/paymentLinks.ts` |
| Existing public routes and payment claim | `apps/api/src/routes/paymentLinks.ts`, `apps/api/src/paymentLinks/pay.ts` |
| Simulator capabilities | `apps/api/src/acquirer/types.ts`, `apps/api/src/acquirer/simulator.ts` |
| Card-input tests | `apps/web/src/pages/checkout/cardInput.test.ts` |
| Browser checks and optional local simulator payment | `apps/web/scripts/checkout.browser.test.mjs` |
| Detailed evidence and limitations | `Evidence/payment_checkout_enhancements.md` |

---

## FEAT-003 — Payment-link creation: editable BHD amounts

**Status:** Implemented and verified on 2026-10-30.

**Baseline HEAD:** `1b1f64b2c3a42d53da6bc3e96a77a6ebe66e8392` (clean working tree before this task).

**Was:** The current creation page used a raw-fils `type="number"` field, not a BHD widget. An installed-Edge regression reproduced `1.` becoming `1`; the previous BHD creation improvements described in the request were absent from this checkout.

**Now:** The merchant enters BHD in a decimal-keyboard text field. The form sends the existing `amountFils` integer payload, using the protected money package without modifying it.

### What the merchant does

1. Opens `/dashboard/payment-links/new` as an owner or finance user.
2. Types, selects, replaces, pastes or deletes BHD text. The decimal stays wherever the merchant puts it; digits are never shifted into a fixed fractional position.
3. Leaves the field or submits the form. A complete, supported amount is normalized to three decimals: `1` or `1.` becomes `1.000`, `1.5` becomes `1.500`, `.001` becomes `0.001`, and `00012.50` becomes `12.500`.
4. Supplies a future expiry and optional reference/description, then creates the link. Existing metadata trimming, API errors and navigation to the created link are retained.

The existing green theme and form styles are reused. The field has an explicit BHD label, a linked precision hint and `inputMode="decimal"` for mobile keyboards.

### Decimal editing and cursor behavior

- Accepted edits remain byte-for-byte as entered while focused. No padding, decimal movement or other formatting runs during typing.
- `1` → `1.` → `1.5` → `1.500` works naturally. Selecting/replacing all of `12.500` with `1.250`, or replacing the fractional digits in `0.100` with `001`, preserves the resulting `1.250` / `0.001` exactly.
- The decimal can be deleted and reinserted at another position, provided each resulting draft has at most three fractional digits. Deleting it from `12.500` yields `12500`, without moving any digits. A second decimal is rejected until the existing decimal is removed or selected for replacement.
- Middle edits retain the browser's native caret. Invalid insertions/pastes leave the original value and selection, including backward selection, intact.
- Native `beforeinput` rejects invalid insertions before mutation where possible. Paste checks the entire proposed replacement, rather than stripping characters or truncating excess precision. An `onChange` fallback restores the last value and selection for non-cancellable/mobile/autofill input events.
- Empty text, `.`, `1.` and `0.` are valid editing states. Empty text and a lone `.` remain visible on blur and cannot submit; they are never silently converted to a payment amount.

### Validation and exact conversion

Drafts allow ASCII digits and at most one period, with zero to three digits after it. Signs (including negative zero), multiple periods, fourth fractional digits, exponent notation, grouping commas, whitespace, currency symbols and localized digits/separators are rejected as a whole. Zero can be edited but cannot create a link.

`bhdAmount.ts` completes the string with a leading zero where needed, strips redundant leading zeros and pads the fraction with string operations. It delegates conversion to the existing `parseBhdToFils`, which uses bigint intermediates and safe-integer validation. No `parseFloat`, floating-point multiplication, rounding or `toFixed` is involved. The page requires a positive branded `Fils` result before submitting.

Examples: `1.500` → `1500`, `1.250` → `1250`, `0.100` → `100`, `0.001` → `1`. The existing numeric API transport supports up to `9007199254740.991` BHD (`Number.MAX_SAFE_INTEGER` fils); `.992` at that whole amount is rejected, not rounded. Unsafe drafts stay visible so the merchant can correct them.

Expiry validation, merchant id from the authenticated dashboard context, owner/finance access and backend validation are retained. This feature changes no API contract, schema, authentication, checkout payment processing, settlement or protected financial implementation, and adds no dependencies. `context/DEPENDENCY_MAP.md` was reviewed: the web-to-money and web-to-API dependencies already exist and need no changes. Existing ADR 0003/0004/0006 financial-policy conflicts remain human questions; this input change makes no settlement, reporting or balance-policy decision.

### Where it lives / files changed

| Piece | Path |
|---|---|
| Creation page: BHD state, submit validation, normalization and fils payload | `apps/web/src/pages/payment-links/PaymentLinkCreatePage.tsx` |
| Text input: native editing, rejection and caret/selection fallback | `apps/web/src/pages/payment-links/BhdAmountInput.tsx` |
| Draft grammar, string completion and existing-parser adapter | `apps/web/src/pages/payment-links/bhdAmount.ts` |
| Pure validation/conversion regression tests | `apps/web/src/pages/payment-links/bhdAmount.test.ts` |
| Installed-Chromium browser regression checks | `apps/web/scripts/paymentLinkAmount.browser.test.mjs` |
| This feature and its verification evidence | `Evidence/features/features.md` |
| Persistent context updates | `context/FRONTEND.md`, `context/PAYMENT_FLOWS.md`, `context/modules/apps-web.md`, `context/TESTING.md`, `context/KNOWN_ISSUES.md`, `context/CHANGELOG.md` |

### Actual verification results

Environment: Windows PowerShell; Node 22.23.2; npm 10.9.8; installed headless Microsoft Edge; existing Vite preview/API; reachable migrated local PostgreSQL 16.15. Go 1.23.1 is below the documented 1.24 prerequisite but is not used by this workstream. Docker CLI 28.3.2 is installed; daemon inspection was denied in the restricted shell. The existing database and services were used; no migrations, seed, truncation or real payment calls were performed. `ops/.env.docker` exists; `DATABASE_URL` was initially unset. Local connection configuration was read from Compose for verification without printing its values.

| Command / check | Actual outcome |
|---|---|
| `npm.cmd run test -w @filspay/web` before changes | PASS: 50 tests |
| `node apps/web/scripts/paymentLinkAmount.browser.test.mjs --baseline` | Expected FAIL against HEAD: typing `1.` produced `1`. The check loads a temporary sibling module with exclusive creation, then removes only that module. It does not change Git history or revert source. |
| `npm.cmd run test -w @filspay/web` after changes | PASS: 55 tests, including five new amount regression cases |
| `npm.cmd run typecheck` | PASS: all workspaces, DB and scripts |
| `npm.cmd run build -w @filspay/web` | PASS |
| `node apps/web/scripts/paymentLinkAmount.browser.test.mjs` | PASS: 11 browser verification groups, all API calls intercepted with sandbox fixtures |
| In `apps/api`, `node --import tsx --test src/routes/paymentLinks.test.ts`, with `DATABASE_URL` set in memory to the migrated localhost development database | PASS: all 8 existing route tests, including creation/read/payment, declines/retries, exact link amount, expiry, cancellation, listing and idempotent recovery; fixtures created by the existing tests, simulated acquirer only |
| Real local PostgreSQL SELECT, including server version and `payment_links` existence | PASS: PostgreSQL 16.15, table present |
| Existing API `GET /healthz`, `GET /readyz`; Vite-proxied `GET /healthz` | All HTTP 200 |
| `node ops/preview.mjs` | Initial restricted-shell attempt failed to load Vite configuration. Retrying with approved unrestricted execution reported port 5173 already in use; the existing preview served the browser checks. No teammate's process was stopped. |

The first restricted-shell web-test attempt failed in Windows `uv_os_get_passwd` before running tests. Approved unrestricted execution passed; Vite build and Edge verification also used approved unrestricted execution. No tests were skipped or weakened.

Browser coverage includes desktop/native typing; decimal insertion, deletion and repositioning; the requested amount examples; middle digit edits; selected replacement/deletion; valid and invalid paste; trailing-dot and empty drafts; native caret and backward selection; non-cancellable input fallback; 390px and 320px mobile viewport edits, arrow/tab navigation and overflow; blur normalization; submission without blur; zero/overflow and expiry rejection; exact fils payloads through the safe-integer boundary; metadata; API errors; success navigation; and the existing support-role form restriction. Paste uses a synthetic clipboard event to exercise the paste handler followed by Chromium insertion for the allowed edit.

Scoped finding **AMOUNT-01** (P2): `confirmed-current` → `fix-verified`, proven by the failing baseline browser check and passing updated check. Counts for this workstream: before `confirmed-current`: 1; after `fix-verified`: 1; all other statuses: 0. No historical BUG-001–BUG-086 counts were reassessed.

### Remaining limitations / not verified

- Physical mobile keyboards, Safari/Firefox, IME composition, operating-system clipboard integration and screen-reader speech were not verified. Localized decimal commas/Arabic numerals are unsupported; use digits `0`–`9` and `.`.
- The browser creation tests use intercepted authentication and API fixtures; they do not prove a browser → real merchant login/OTP → creation → database journey. The existing route tests independently verify real local API/database payment-link behavior.
- Broader admin/auth/KYC, reporting and settlement journeys, the full API workspace suite and real-provider payment processing were not rerun. No whole-application end-to-end claim is made.
