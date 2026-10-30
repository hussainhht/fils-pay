# Link expiration UI and exact custom date/time

Date: 2026-10-30 (Asia/Riyadh / Bahrain, UTC+03:00).

## Baseline and scope

Starting HEAD: `d28fa2625b25a9ac27610413b231f4bedd86ec7b`.
Initial git status contained unrelated pre-submission cleanup/test-tooling work.
That work was preserved and was committed by another actor during this task as
`a1110b7f3dfd2229ae445ce220b14ac83149fdf0`. Its expiration source is identical
to the starting baseline. This task performed no commit, staging, branch switch,
merge, rebase, push or deployment, and did not delegate to other agents.

Inspected the current creation UI, styles, API client/type, merchant creation
route/service, expiration policy, read/status/pay admission, relevant tests and
task-routed persistent context. No prohibited historical agent instructions read.

The existing API already accepts exactly one of `expiresInSeconds` or `expiresAt`.
Both use an inclusive 15-minute/120-day creation window relative to server time.
No backend, partner API, money package, schema, migration, payment processing,
settlement, refund or webhook source was changed.

## Confirmed findings and changes

| Finding | Severity | Before | After | Proof |
|---|---|---|---|---|
| EXPIRY-UI-01: custom mode accepts only numeric duration/unit, not exact date/time | P2 | `confirmed-current` | `fix-verified` | Original browser module copies fail the calendar-input assertion. New labeled native date/time inputs produce exact UTC timestamps and pass boundary/payload/aging checks. |
| EXPIRY-UI-02: overlapping expiration helpers | P3 | `confirmed-current` | `fix-verified` | Original adjacent `.dash-hint` paragraphs use `margin: -8px 0 0`; browser bounding rectangles confirm overlap. New scoped layout passes non-overlap checks including input errors at all four viewports. |

Scoped counts before: `confirmed-current` 2, every other status 0.
Scoped counts after: `fix-verified` 2, every other status 0.
No remaining confirmed-current P0–P2 in this workstream; historical registry
counts and unrelated findings were not audited.

All presets remain: 15 Minutes, 24 Hours (default), 7 Days, 30 Days, 90 Days,
Custom Expiration. Native radio grouping keeps exactly one selected. Presets send
their full server-relative duration, ignoring hidden custom drafts. Their readable
date/time preview is estimated and explains when the server calculates/saves it.

Custom mode uses native calendar and hour/minute controls. It interprets all input
in explicitly labeled Bahrain time, fixed UTC+03:00 with no DST, and converts via
an explicit offset to ISO UTC `expiresAt`. It never uses device-local Date parsing.
The preview retains the exact chosen instant even if the form remains open.
Strict date/time grammar rejects impossible dates, seconds, malformed/past values
and out-of-window selections. Native date/time bounds round inward to selectable
minutes. Client limits refresh every 30 seconds, on edits/focus and at submit.
The server continues validating and storing the authoritative deadline.

Field errors use `aria-invalid`, `aria-describedby` and alert text directly below
the relevant control. Missing values become field errors after blur; the preview
explains what to select before then. Expiration API errors are mapped to readable
inline guidance. CSS uses scoped gaps, normal paragraph margins, shared green
tokens and stacked date/time fields below 540px. No dependencies were added.

## Environment and real verification

Windows PowerShell; Node 22.23.2, npm 10.9.8; existing dependencies, API :3000 and
Vite web/admin :5173/:5174. PostgreSQL 16.15 reached with a read-only local
connection derived in memory from existing Compose configuration; credentials
and payment-link tokens were never printed. `DATABASE_URL` was absent from the
process environment, and ignored `ops/.env.docker` was present. Go is 1.23.1
(below the AGENTS-listed 1.24 prerequisite; Go is outside this UI scope).
Docker client 28.3.2 is installed, but Docker config/daemon access was denied in
the restricted shell; existing services were reused without starting infrastructure.

| Command/check | Outcome |
|---|---|
| Initial git status and HEAD; scoped source/context inspection | Baseline/ownership confirmed; unrelated edits preserved |
| `node apps/web/scripts/paymentLinkAmount.browser.test.mjs --baseline` | Expected failure: custom calendar input is absent; original module copies used and then removed |
| `node apps/web/scripts/paymentLinkAmount.browser.test.mjs --baseline --check-layout-first` | Expected failure: original controls/helpers overlap (the first recorded run used the temporary flag name `--layout-only`, since renamed) |
| `npm.cmd run test -w @filspay/web` | **72 passed, 0 failed/skipped**; nine focused expiration unit cases |
| `node --import tsx --test apps/api/src/paymentLinks/expiration.test.ts apps/api/src/paymentLinks/create.test.ts apps/api/src/paymentLinks/pay.test.ts apps/api/src/paymentLinks/status.test.ts` | **17 passed, 0 failed/skipped**; existing database-free server policy/guard/clock/status tests |
| `npm.cmd run typecheck` | **PASS**, all workspaces, DB and scripts |
| `npm.cmd run build -w @filspay/web` | **PASS**, Vite production build |
| `node apps/web/scripts/paymentLinkAmount.browser.test.mjs --check-layout-first --screenshots` | **15 browser groups passed**, all API requests intercepted; 1440/768/390/320px layout assertions and desktop/mobile screenshots |
| API `GET /healthz`, `GET /readyz` | **200**, both |
| Web `/v1/auth/me` and admin `/v1/admin/auth/me` proxies without session | Expected **401** from the API |
| Actual local `BEGIN READ ONLY`, `SELECT 1`, PostgreSQL version, rollback | **PASS**, PostgreSQL 16.15 |
| Read existing active-but-expired link via public GET; compare response deadline to persisted timestamp | **PASS**, public `expired` status and unchanged persisted expiration; no payment submitted |
| `git diff --check` | **PASS** |

Windows sandbox attempts initially blocked tsx OS-user lookup (`uv_os_get_passwd`),
Vite parent-directory resolution and Edge lifecycle. Approved execution outside
the sandbox succeeded. These were environment failures, not test assertion passes.
An intermediate browser assertion expected a stale preset preview and was corrected
to require refresh after submit; a geometry selector was corrected to compare
siblings rather than a preview container against its nested text. No application
tests were disabled or weakened. Existing amount, metadata, role and navigation
coverage remains in the harness.

Browser verification covers all five preset payloads, single green selection,
native radio arrow navigation, missing/past/invalid values, exact minimum/maximum,
native form validity, exact custom UTC payloads, stable custom selection as form
age advances, server `invalid_expiry` guidance and separated field errors. Unit
tests also cover Bahrain midnight, valid leap dates, minute rounding, and host
UTC/New York/Berlin/Tokyo zones including DST gaps/repeated hours.

Screenshots reviewed visually:

- [Desktop custom](link-expiration-1440-custom.png)
- [Desktop inline error](link-expiration-1440-error.png)
- [320px custom](link-expiration-320-custom.png)
- [320px inline error](link-expiration-320-error.png)

## Files changed and context maintenance

- `apps/web/src/pages/payment-links/ExpirationInput.tsx`, `ExpirationInput.css`:
  native controls, scoped spacing, preview, accessible inline errors.
- `apps/web/src/pages/payment-links/expiration.ts`, `expiration.test.ts`:
  typed mutually exclusive payloads, exact conversion/bounds and nine regressions.
- `apps/web/src/pages/payment-links/PaymentLinkCreatePage.tsx`: custom date/time
  state, clock refresh, fresh submit validation and inline API expiration errors.
- `apps/web/scripts/paymentLinkAmount.browser.test.mjs`: updated expiration
  coverage, original-module baseline mode, non-overlap assertions and optional
  screenshots; retained unrelated existing amount/role/metadata checks and live mode.
- Four PNGs listed above and this report.
- `context/FRONTEND.md`, `modules/apps-web.md`, `API.md`, `PAYMENT_FLOWS.md`,
  `DECISIONS.md`, `TESTING.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`: refreshed
  descriptions, behavioral choice, test outcomes and scoped status delta.

`context/DEPENDENCY_MAP.md` was reviewed: no new package/service dependency or
interface change. No architecture rewrite is needed. The behavioral choice is
recorded in DECISIONS without changing any accepted ADR. Conflicts involving
ADRs 0003/0004/0006 and HANDOVER remain open human questions; ADR 0005 remains paused.

## Limits and remaining acceptance

No disposable integration database was configured, so the full API workspace,
DB-backed route/history/recovery suites and browser `--live` authentication to
creation/payment were **not run**. Existing local DB access was read-only.
The unchanged pay admission SQL still requires `expires_at > now()` for a new
attempt; no real POST payment rejection, authorization or capture was exercised.
No seed, migration, fixture write, destructive command or real payment/provider
call was performed. No claim of full end-to-end payment verification is made.

Physical devices, Safari/Firefox and native OS picker popup interaction were not
verified. Chromium responsive layouts, keyboard radios and date/time input types,
values and native validity were verified. At a custom deadline exactly 15 minutes
away, network delay or clock differences can cause the unchanged server to reject
it; the UI presents inline guidance instead of moving the selected time or relaxing
the policy. No further confirmed scoped defect remains.
