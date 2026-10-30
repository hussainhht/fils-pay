# Payment-link commit investigation — 2026-10-31

- Baseline HEAD: `f4b5a1af6eb8eeac3844b4dbdf6de7b7501ecf12`.
- Environment: Windows, Node 22.19.0, npm 10.9.3, Go 1.24.2. Docker command unavailable; `DATABASE_URL` unset and `ops/.env.docker` absent in this shell. A PostgreSQL listener exists on localhost:5432, but its connection configuration and database were not verified.
- Existing unrelated working-tree changes: modified `.api-run.log` and deleted presentation file; left untouched.

## Finding

`2679bef60f265b27372905a0aad595cfa98baa39` (2026-10-30 22:21:30 +0300), an ancestor of HEAD, changed the dashboard request from `expiresAt` to `expiresInSeconds` and updated the API in the same commit. Its parent `850504a` rejects duration-only requests with the exact screenshot message `amountFils and expiresAt are required`. Current source accepts duration and no longer emits that message. Thus an updated frontend talking to an older API is a strongly supported explanation, but the exact server that produced the screenshot was not independently identified.

Local `/healthz` reported uptime of 23611 seconds at 2026-10-31 00:14:36 Bahrain time, implying an API start around 17:41 on October 30, before the suspect commit's recorded time. This supports a stale process hypothesis, not proof of its loaded revision. Restart or redeploy the API from current source and repeat the authenticated creation journey to confirm.

Scoped status: version mismatch `unverified` as the precise runtime cause (1); all other scoped status counts 0. No code fix was made; current matching source has not been shown to reproduce the error. Historical registry not reassessed.

## Verification

- `git show` of commit and parent: confirmed request/route changes and exact old error.
- `npm run test -w @filspay/web`: 67 passed.
- `node --import tsx --test apps/api/src/paymentLinks/expiration.test.ts apps/api/src/paymentLinks/create.test.ts`: 6 passed; these do not prove a DB-backed create.
- `node --import tsx apps/web/scripts/paymentLinkAmount.browser.test.mjs`: 14 groups passed; API requests intercepted/mocked.
- `npm run typecheck`: passed.
- `curl` localhost API `/healthz` and `/readyz`: HTTP 200; web proxy `/healthz`: 200 and `/v1/payment-links/nonexistent`: API 404. PowerShell `Invoke-WebRequest` initially failed despite reachable services; curl confirmed connectivity.
- No authenticated real creation, database query, API workspace DB tests, or full payment journey run; no database credentials supplied in this shell. No server restart or data mutation performed.

Files changed: this report only. Relevant payment-link context was reviewed; no implementation changed, so context maintenance was not necessary. Existing ADR 0003/0004/0006 and handover financial conflicts remain open human questions; they were not evaluated here.
