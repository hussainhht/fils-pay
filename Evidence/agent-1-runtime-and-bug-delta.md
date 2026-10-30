# Agent 1 â€” Runtime and Bug Delta
Baseline HEAD: d6e6bbbb03b6bf45ef45163c55f20dea6cc16fca
Final verified HEAD / worktree state: same HEAD; initially clean, this report added; no runtime code changes.
Environment: Windows NT 10.0.26300.0; Node 22.19.0, npm 10.9.3 via npm.cmd, Go 1.24.2. PowerShell blocks npm.ps1. Docker, psql, postgres and pg_ctl absent from PATH; Docker Desktop absent at its standard path; no matching Docker/Postgres service found. DATABASE_URL and ops/.env.docker absent. No secret values recorded.

## Baseline startup and test evidence
- `git status --short`: clean. `npm.cmd run typecheck`: PASS.
- `npm.cmd run build -w @filspay/web` and `npm.cmd run build -w @filspay/admin`: PASS; web reports a chunking warning.
- `npm.cmd test`: incomplete; events 4/4 and money 40/40 passed; API tests fail because DATABASE_URL and migrated Postgres are missing. Stopped after repeated prerequisite failures; no complete suite totals claimed.
- `npm.cmd run migrate` and `npm.cmd run dev -w @filspay/api`: FAIL, DATABASE_URL not set. No migrations or seed run against a database.
- Existing 5173 and 5174 login pages return HTTP 200; API /healthz and /readyz on 3000 refuse connections. Requests to /v1/auth/me and /v1/admin/auth/me through the respective frontends return HTTP 500. `node ops/preview.mjs` fails because 5173 is occupied. Existing server provenance and proxy configuration are unverified. No authenticated sessions established.
- `node --import tsx --test db/seed/safety.new.test.ts`: PASS 4/4. An attempted config test at apps/api/src/config.test.ts failed because that file does not exist.
- Architecture, ADRs, handover, changelog, ops README and bugfix plan reviewed. Handover is historical (for example, it says there is no balance rebuild console button while architecture describes one); architecture's development settlement token default conflicts with ops README's daemon requirement. Current code and checks take precedence.

## Candidate bug ledger
The 86 numbered historical reports were read and listed once by ID. Historical Critical maps to P0, High to P1, and Medium/Low to P2/P3 as an approximation, not a current impact assessment. Except BUG-054, reports remain unverified at this HEAD; duplicate and cross-domain assessments are incomplete. Old reports and validation are leads, not current proof. BUG-057 includes external credential rotation which cannot be verified locally.

| ID | Domain | Priority | Before status | Evidence / reproduction | Owner | After status | Test / runtime proof |
|---|---|---|---|---|---|---|---|

| BUG-001 | Authentication and sessions | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-002 | Authorization and tenant isolation | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-003 | Authorization and tenant isolation | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-004 | Authorization and tenant isolation | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-005 | Payments and payment links | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-006 | Payments and payment links | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-007 | Refunds | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-008 | Refunds | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-009 | Ledger and financial calculations | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-010 | Ledger and financial calculations | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-011 | Admin console and controls | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-012 | Admin console and controls | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-013 | Database and migrations | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-014 | Database and migrations | P0 | unverified_or_environment_blocked | historical report; current reproduction pending | runtime / shared | unverified | not tested for this report |
| BUG-015 | Authentication and sessions | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-016 | Authentication and sessions | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-017 | Authentication and sessions | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-018 | Authorization and tenant isolation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-019 | Authorization and tenant isolation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-020 | Authorization and tenant isolation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-021 | Authorization and tenant isolation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-022 | Payments and payment links | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-023 | Payments and payment links | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-024 | Payments and payment links | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-025 | Payments and payment links | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-026 | Payments and payment links | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-027 | Refunds | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-028 | Refunds | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-029 | Ledger and financial calculations | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-030 | Ledger and financial calculations | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-031 | Ledger and financial calculations | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-032 | Ledger and financial calculations | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-033 | Ledger and financial calculations | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-034 | Settlement and reconciliation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-035 | Settlement and reconciliation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-036 | Settlement and reconciliation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-037 | Settlement and reconciliation | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-038 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-039 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-040 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-041 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-042 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-043 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-044 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-045 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-046 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-047 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-048 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-049 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-050 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-051 | Webhooks | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-052 | Reporting and analytics | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-053 | Reporting and analytics | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-054 | Database and migrations | P1 | stale_or_fixed_before_start | guard and default Compose exclusion present | runtime / shared | same | seed safety tests 4/4 pass |
| BUG-055 | Database and migrations | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-056 | Frontend | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-057 | Infrastructure and configuration | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | runtime / shared | unverified | not tested for this report |
| BUG-058 | Infrastructure and configuration | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | runtime / shared | unverified | not tested for this report |
| BUG-059 | Authentication and sessions | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-060 | Authentication and sessions | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-061 | Payments and payment links | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-062 | Ledger and financial calculations | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-063 | Settlement and reconciliation | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-064 | Settlement and reconciliation | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-065 | Settlement and reconciliation | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-066 | Settlement and reconciliation | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-067 | Settlement and reconciliation | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-068 | Webhooks | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-069 | Webhooks | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-070 | Webhooks | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-071 | Reporting and analytics | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-072 | Reporting and analytics | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-073 | Reporting and analytics | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-074 | Reporting and analytics | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-075 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-076 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-077 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-078 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-079 | Infrastructure and configuration | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-080 | Infrastructure and configuration | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | runtime / shared | unverified | not tested for this report |
| BUG-081 | Database and migrations | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | runtime / shared | unverified | not tested for this report |
| BUG-082 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-083 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-084 | Reporting and analytics | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-085 | Frontend | P2/P3 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |
| BUG-086 | Admin console and controls | P1 | unverified_or_environment_blocked | historical report; current reproduction pending | domain owner | unverified | not tested for this report |

## Runtime fixes implemented
| Change | Files | Why | Regression test | Verification |
|---|---|---|---|---|
| None | â€” | Supported DB runtime unavailable; no confirmed in-scope code defect established | â€” | â€” |

## Current startup recipe and end-to-end smoke results
Provision Docker Desktop / Docker Engine with Compose v2 through the machine owner, then from the repository root run `node ops/setup-env.mjs`, `docker compose -f ops/docker-compose.yml up --build -d`, and `docker compose -f ops/docker-compose.yml logs migrate api settlement reporting`. Check `http://localhost:3000/healthz` and `/readyz`. For isolated fixture data only, follow the explicit stopped-services and opt-in seed procedure in `ops/README.md`; it truncates tables. Start `node ops/preview.mjs` after freeing 5173 and 5174 or use existing servers after verifying configuration. Test merchant and admin login including OTP and API-backed pages. Docker startup, DB readiness, migration, fixture login, authenticated pages and successful UI-to-API communication were not verified here. Do not seed an existing database.

## Before / after (after all agents are integrated)
- Historical candidate reports: 86 numbered reports.
- Duplicates / stale / already fixed at baseline: at least 1 (BUG-054 unconditional seed); remaining reports not fully adjudicated or deduplicated.
- Confirmed, distinct defects at baseline: not measured (P0/P1/P2/P3 breakdown not measured).
- Baseline defects demonstrably fixed and verified: 0 in this work.
- Baseline defects still confirmed unresolved: not measured.
- New defects confirmed after baseline: 0 identified; not an exhaustive assessment.
- Unverified/blocked defects (excluded from confirmed counts): 85 report IDs pending adjudication, including partially addressed BUG-057.
- Confirmed unresolved NOW: not measured.
- Net change in confirmed unresolved: **not measurable yet**; no complete baseline or integration verification.
- Confidence/limitations: missing supported database runtime and fixtures; full suite stopped after prerequisite failures; cross-domain reports and potential duplicates not independently validated; no Agent 2/3 integration supplied or verified.

## Remaining release blockers and handoffs
- Runtime owner: provision supported Docker/Postgres locally, then run migrations, readiness and disposable fixture smoke; rerun full suite and both authenticated UIs. API connectivity is currently blocked.
- Agent 2 / Agent 3: independently verify identity/admin and payment reports at the actual integrated HEAD, with distinct reproductions and tests; contribute their ledgers before a combined count.
- BUG-057: credential owner must determine whether previously exposed external credentials were rotated; local evidence cannot establish that.
- BUG-014: old report notes existing databases with previously applied migrations require separate forward-repair assessment; fresh database validation remains blocked here.
