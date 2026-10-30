# Payment-link creation runtime investigation

Date: 2026-10-30 (Asia/Bahrain). Baseline HEAD: `18ab7ca37a99aac28b4ebd1f4d9c1a2960dda970`.

## Finding

The screenshot shows `amountFils and expiresAt are required`. The API route before commit `2679bef` emitted that exact message and required `expiresAt`. Current `PaymentLinkCreatePage.tsx` sends `amountFils` and `expiresInSeconds`, and the current API route accepts this duration. The API responding on localhost:3000 reported over six hours of uptime, while `2679bef` was committed at 22:21 Bahrain time. The Vite proxy on localhost:5173 returned the same health response. These facts strongly indicate that the running API has the older route loaded; restarting it with the current code should resolve the contract mismatch.

Status: runtime mismatch **confirmed-current** from screenshot and source/version evidence; resolution **unverified** until the running API is restarted and an authenticated test link is created. No historical BUG registry entry was identified for this deployment mismatch.

## Environment and checks

- Node 22.19.0, npm 10.9.3, Go 1.24.2; Docker command unavailable. `DATABASE_URL` is not set in this shell and `ops/.env.docker` is absent. Postgres connections were visible on localhost:5432, but no independent database query was performed.
- `GET localhost:3000/healthz` returned ok; `/readyz` returned ready. `GET localhost:5173/healthz` returned the API health response. These do not verify authenticated link creation or a current database query.
- `npm.cmd run test -w @filspay/web`: 67 passed.
- `npx.cmd tsx --test apps/api/src/paymentLinks/expiration.test.ts`: 5 passed.
- Existing unrelated changes and other active API/test processes were observed. No running process was restarted and no source files or database were changed. An authenticated creation, end-to-end checkout, complete API suite and typecheck were not run for this investigation.

Files changed: this report only. Relevant payment-link context was reviewed; no implementation changed, so no context update was needed. The ADR 0003/0004/0006 and handover financial-integrity conflicts remain open for a human and were not investigated in this workstream.
