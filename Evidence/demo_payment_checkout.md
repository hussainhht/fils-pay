# Hackathon demo payment checkout — 2026-10-31

## Root cause

Hosted POST `/v1/payment-links/:token/pay` returned 403. API logs identify
failed requests `req-w` and `req-1j`. A fresh HTTPS reproduction returned
`{"stage":"authorize","error":"merchant_not_approved"}`. The linked merchant
was active and test-mode, but onboarding was `submitted`. The links were active,
unexpired, had positive database-owned amounts, no outstanding reservations,
and no completed transaction. `paymentLinks/pay.ts` claimed the link, then
`payments/authorize.ts` rejected it before any acquirer call and released the
reservation. The frontend's generic 403 handler rendered “Unable to pay”.
This was not a missing provider, configuration, capture, transition or database
failure. The original app already uses an in-process randomized simulator.

## Implementation and isolation

`DEMO_PAYMENT_MODE` defaults to false. When true, only public checkout for a
database-owned `test_mode=true` merchant uses the new deterministic adapter.
Live merchants and other payment routes retain the original acquirer. Merchant
active/approved checks, link expiry/cancellation/claim rules, integer amount
handling, ownership and idempotency remain in their existing services.
Authorization references use `demo_` plus a deterministic operation hash,
stable across process restarts. Capture refuses non-demo references.

Transaction states: `authorized -> captured`; link states:
`active -> reserved -> paid`. The existing authorization creates the transaction
and hold; capture releases the hold and atomically writes fees, balanced ledger,
events and idempotent response. Link finalization follows capture as before.
The success response shape is unchanged. Public reads now include an optional
receipt for paid links so a refresh renders the green success screen without
another POST. The receipt shows BHD to three decimal places, merchant,
transaction ID, local date/time and Paid status.

## Deployment and hosted verification

Release: `/srv/filspay/releases/20261031-demo-checkout` on
`dilmune@68.183.82.221`. Built `filspay-node:demo-checkout`, including full
repository typecheck and both frontend production builds. Updated only the API
environment flag and recreated only API with `--no-deps`; switched static assets
and reloaded nginx after its configuration test passed. Reporting, settlement,
PostgreSQL and persistent volumes were not restarted or migrated.

Previous API image retained as `filspay-node:before-demo-checkout`; API config
backup: `/etc/filspay/api.env.before-demo-checkout`. Previous static release:
`/srv/filspay/releases/20261031-browser-otp`. To disable deterministic simulation,
set `DEMO_PAYMENT_MODE=false` in server-only API env and recreate API. This
restores the original simulator; it does not install a real provider.

Approved only the existing synthetic FilsPay Test Merchant
`a01a544d-e399-4846-89d0-bf688f7ebf4b` via `recordKycReview`, with operator
identifier `hackathon-demo-operator` and an explicit synthetic-demo note.
`test_mode=true` remains set. No real KYC was represented as verified.
Created the verification link through `createPaymentLink` for 4,750 fils.

Hosted checkout URL:
https://68-183-82-221.sslip.io/pay/plink_tWEZG9aAAzmdjygelxYd0A

- HTTPS checkout HTML: 200; public read initially active.
- HTTPS payment POST: 200, paid; amount 4,750 fils = BHD 4.750.
- Transaction: `dbddc579-a4c8-49ec-a172-9e19909cd049`.
- Acquirer reference: `demo_8df24207d2e079fcc3d04475f371ef1b`.
- Paid: `2026-10-31T09:40:17.344Z` (12:40:17 Asia/Bahrain).
- Same-key POST replay returned the identical receipt. New-key attempt returned
  `payment_link_already_paid`; refreshed GET returned the persisted receipt.
- Authenticated dashboard endpoints `/v1/transactions`, merchant payment links,
  and `/v1/analytics/volumes` returned 200. Transaction was captured, amount and
  captured amount both 4,750. Volume projection showed count 1 / gross 4,750.
  A temporary verification API key was issued through the existing service,
  kept only in process memory, then revoked in `finally`.
- Database: one capture ledger group, four entries, debit/credit balance zero;
  authorized and captured audit events; zero settlement batches for this test
  merchant. Existing test-mode settlement exclusion is retained.
- Startup warning confirmed. Final HTTPS `/healthz` and `/readyz`: 200.

## Focused checks and limits

- Local repository typecheck passed; web tests 67/67; demo adapter test 1/1.
- Real migrated isolated validation PostgreSQL: existing payment-link tests and
  new adapter test passed. The new demo integration test initially failed only
  its readiness assertion: `app.inject` does not execute the entrypoint boot
  readiness probe. Replaced that inappropriate assertion with a DB query;
  focused rerun passed 1/1. Remaining 12 tests had already passed.
- Integration verified concurrent same-key submissions create one transaction
  and one balanced ledger group; paid receipt survives read; different-key paid
  attempt fails; expired/invalid links fail; disabled demo mode uses normal card
  decline; live merchants do not use demo adapter; unapproved test merchants
  still fail. Hosted health/readiness checked against the real booted process.
- No broad API suite or load testing was run, per the user's request to limit
  testing. Browser/native automation hosts were unavailable (no enabled surfaces),
  so the deployed verification used actual HTTPS requests and authenticated
  dashboard APIs. A visual browser Pay click and rendered-page inspection were
  not completed. The tested link is now paid; create a fresh dashboard link for
  the live demo. No real card network or payout is exercised.

## Files changed

- `apps/api/src/config.ts`, `app.ts`: flag and startup warning.
- `apps/api/src/acquirer/demo.ts`, `demo.test.ts`: isolated adapter and test.
- `apps/api/src/paymentLinks/pay.ts`: test-merchant-only adapter selection.
- `apps/api/src/paymentLinks/read.ts`: persisted public receipt.
- `apps/api/src/routes/paymentLinks.ts`, `paymentLinks.test.ts`: flag plumbing
  and focused database integration coverage.
- `apps/web/src/types.ts`, `pages/checkout/CheckoutPage.tsx`: receipt rendering
  after success and refresh.
- `ops/README.md`: operation and disable instructions.
- `Evidence/demo_payment_checkout.md`: this report.

Pre-existing edits to AGENTS.md, CLAUDE.md and GEMINI.md were preserved. An
unrelated running process changed `.api-run.log`; it was not edited for this task.
