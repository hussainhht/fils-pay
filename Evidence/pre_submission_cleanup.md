# Pre-submission cleanup and release verification

Date: 2026-10-30, Bahrain / Riyadh (UTC+3), before the 23:00 submission freeze.
Scope: minimal repository cleanup and test isolation; no application refactoring.

## Git baseline and ownership

- Branch: `test/features-news`; starting working tree clean.
- Initial challenge bootstrap: `669af5289f12bbe156f452058a91ed667e426334`
  (2025-08-03, `bootstrap monorepo and tooling`).
- Starting/current HEAD: `d28fa2625b25a9ac27610413b231f4bedd86ec7b`
  (`Merge main into payment-link feature branch`). No commit was created.
- Latest history includes payment-link expiration/amount work, webhook work and
  the main merge. No history, branch, index, remote or published code was changed.
- Initial tree: 11 files. HEAD: 819 tracked files. Initial-to-HEAD comparison:
  810 additions, 6 modifications, 2 historical deletions. Those two deletions
  predate this cleanup; no initial path was deleted by this work.
- The initial commit contains scaffolding only. Original challenge services were
  added later, e.g. API scaffold `cece910` on 2025-08-10. Therefore “post-initial”
  does **not** prove team ownership. The path-by-path historical inventory is
  [release-file-provenance.tsv](implementation/release-file-provenance.tsv):
  11 bootstrap paths, 441 later challenge-construction paths, 369 paths first
  introduced on the hackathon date. Dates are navigation evidence, not ownership
  authorization. All uncertain code was preserved.

Inspected context README/router, dependency/testing/infrastructure/operations
context, architecture, manifests, Dockerfiles/Compose, runtime entrypoints,
current evidence/bug registry, PMA-08, main-merge and webhook reports. Two agents
performed read-only test-safety/provenance audits; implementation stayed with one
agent in the original clean checkout. No prohibited historical agent instructions
were read and no fork code was imported.

## Files removed and preserved

Removed only `.webhook-typecheck.log` (906 bytes), introduced by team webhook
commit `85803e4c8f43fc6e02a9b053db02a20d1378ae57`, 2026-10-30. Its retained
counterpart `.webhook-typecheck-final.log` is byte-identical:
SHA-256 `A26C4A17347D0FADAF0C7BCA2195BA7254EC92C06DC93EBC74E01EB3C0540F5A`.
No active application, dynamic import, CLI, job, config or documentation reference
requires the deleted filename. Docker already excludes logs. Complete test output
remains in the final log, with outcomes also recorded in webhook evidence. No log
contents were printed. `.gitignore` now ignores future generated `*.log` files;
existing tracked evidence logs remain tracked and intact.

Preserved the other 17 root logs, all `Evidence/`, submission guidelines, context,
AI instructions/configuration/helper scripts, docs/ADRs/runbooks, migrations,
fixtures, screenshots and capacity evidence. Apparent unused original scaffold
helpers/dependencies (`lib/decimal.ts`, chalk, lodash) were retained. The checkout
preview script is a documented screenshot tool; the separate old checkout form
still has regression-test callers. No production source, financial formula,
schema, protected money file, partner API, worker or deployment config changed.

## Test classification and quarantine

| Class / retained examples | Release behavior and reason |
|---|---|
| Useful DB-free samples: money, events, web query/format/date/render tests | Kept in default checks; validates exact money, event contracts and UI helpers |
| Essential financial/security regressions: money precision/refund fee; checkout retry/expiration; SQL empty-filter; retired March CLI; seed refusal | Kept; database-free cases run by default, DB cases retained for explicit isolated verification |
| API `src/**/*.test.ts` | Excluded from root default; workspace/full command runs preflight before suite import. Many cases write merchants, sessions, payment/ledger fixtures |
| API `fees/platformVolumeTier.test.ts` | Quarantined with API suite: cleanup resets the global platform counter |
| Reporting `src/**/*.test.ts`, especially `cli/rebuild.test.ts` | Quarantined: real rebuild truncates/replays reporting rollups |
| Go settlement `*_test.go`, especially `platform_volume_test.go` | Not in default npm tests; new guarded command retained. Tests write fixtures and reset a global counter |
| March stress and seed self-verification integration tests | Kept in explicit integration command; temporary tables/rollback are useful evidence, not grounds for deletion |
| Manual browser/live/load scripts | Preserved; never invoked by default npm tests, builds or startup. No live/load run executed |
| Duplicate retirement regressions and historical temporary-named money cases | Preserved: useful safeguards/original provenance; no assertions skipped or deleted |

`npm test` -> `npm run test:unit` -> `scripts/test-unit.mjs`, an explicit audited
allowlist. Child processes have inherited `DATABASE_URL` and
`PGCONN_SETTLEMENT` and `SETTLEMENT_DATABASE_URL` removed. Default execution performs no database initialization
or live financial operation.

Full tests remain under `npm run test:integration`; the command also includes
previously omitted `db/seed/*.test.ts` and `scripts/lib/*.test.ts`. API/reporting
workspace tests and `npm run test:settlement` have the same
`ops/test-database.mjs` preflight. It uses Node built-ins only, never connects,
and requires a loopback PostgreSQL URL with a `filspay_test[_suffix]` name.
Production mode, alternate connection environment settings and URL query
overrides are rejected (only SSL mode is allowed). Errors omit connection values.
These suites require a separately authorized disposable, already migrated test
database; a matching database name alone does not prove disposability.

Direct `tsx --test`, bare `go test`, and browser `--live` commands bypass this
command-level guard. They remain manual evidence tools and must never target
development/shared/staging/production data. No tests were disabled to hide an
assertion failure. No tests automatically migrate, seed or reset a database as
part of the new release checks.

## Commands and actual outcomes

Environment: Windows PowerShell, Node 22.23.2, npm 10.9.8, Go 1.23.1. Existing
node_modules, ignored local Docker env and local API/web/admin/Postgres available.
No process-level DATABASE_URL. Local env names/presence were checked without
printing values. Docker client 28.3.2 exists; daemon/config access denied. No
infrastructure or deployment was started.

| Command / check | Real result |
|---|---|
| Git status/branch/recent log/root commits/initial tree/diff | Clean starting tree; baseline and inventory above |
| `node --test ops/test-database.test.mjs` before implementation | 4 failed: unsafe default wiring and missing guard confirmed; CLI test path then corrected to native Windows path |
| Same focused check after implementation | 4 passed, zero skipped; allowed local targets, unsafe URLs/overrides/production refusal and credential-safe CLI errors |
| `npm.cmd test` final | **134 passed, 0 failed, 0 skipped**: money 40, events 4, web 67, preflight 4, script/seed safety 19 |
| `npm.cmd run typecheck` | **PASS**, all workspaces, DB and scripts |
| `npm.cmd run build -w @filspay/web` | **PASS**, Vite production build |
| `npm.cmd run build -w @filspay/admin` | **PASS**, Vite production build |
| `npm.cmd ls --workspaces --depth=0` | **PASS**, no missing/invalid workspace dependencies reported; no install/upgrade/lockfile mutation |
| Seven workspace/root manifest dependency specifications compared with root lockfile | **PASS**, semantically identical; an initial order-sensitive comparison was corrected |
| `go build -buildvcs=false -o <temporary executable> ./cmd/settlement` with temporary GOCACHE | **PASS**; no daemon/job executed |
| Root integration/API/reporting/settlement npm commands, DATABASE_URL absent | All **refused with exit 1 before suite execution**, expected safety outcome; not integration passes |
| API `/healthz`, `/readyz` | HTTP 200 |
| Web/admin proxied `/healthz` | HTTP 200, JSON |
| Read-only `SELECT 1 AS reachable` using local Compose destination in memory | **PASS**, real current DB query; no writes |
| Web `/pay/preview`, `/dashboard/login`; admin `/login` | HTTP 200 HTML; route shells only, not browser journey proof |
| API and web proxy `/v1/auth/me`; admin proxy `/v1/admin/auth/me` | HTTP 401 anonymous; confirms correct API routing/auth rejection |
| Git diff whitespace and scope review | PASS; application/payment/settlement source unchanged |

Restricted-shell tsx first failed on Windows user lookup; Vite first failed on
configuration directory permissions. Approved outside-sandbox safe tests/builds
passed. An intermediate unit command failed two existing retirement assertions
because deployment automation contained the retired script name even as a test
filename. The explicit test list was placed under `scripts/`, leaving deployment
automation free of that reference; both existing assertions now pass unchanged.
Go's initial build failed VCS stamping due to Git ownership; `-buildvcs=false`
allowed the temporary binary check without editing Git configuration. Initial
HTTP probes at incorrect `/v1/me` paths returned 404; source-confirmed auth paths
above return 401. These are verification corrections, not application fixes.

No API/reporting/Go database-backed suite, migration, seed, reset, refund,
payment simulation, settlement job or load test was run. Existing services were
left running. Earlier full-suite/runtime reports are historical evidence, not
newly executed proof.

## Submission checklist from the four-page PDF

The local `FilsPay_Submission_Guidelines_261030_161113.pdf` was decoded/read in
full using Python standard-library PDF stream/CMap extraction, without adding
dependencies. Its instructions are the submission checklist, not authorization
to commit/push. Freeze: **Friday 2026-10-30 23:00 Bahrain (20:00 UTC)**; nothing,
including code/server/documents/slides, may change after that deadline.

| Required deliverable / section | Preserved source and current readiness |
|---|---|
| `TeamName_FilsPay_Submission.pdf` | No matching final document found in repository; team must assemble/export using actual team name |
| `TeamName_FilsPay_Slides.pdf` | No matching final slides PDF found; recommended eight-slide structure remains in guidelines |
| Own public GitHub fork with complete project and AI setup | Configured origin is `https://github.com/hussainhht/fils-pay.git`; ownership, public visibility and fork relationship unverified. Read-only GitHub API lookup unavailable; nothing pushed |
| Cover page: team/members/ownership, checkout/dashboard/admin/API URLs, fork and final commit | Team metadata/public URLs not supplied. Current local HEAD recorded above is not a claimed final published submission commit |
| 1. Summary | Bug registry, main-merge/PMA reports and this cleanup evidence preserved |
| 2. Architecture and deployment | `docs/ARCHITECTURE.md`, `context/ARCHITECTURE.md`, `context/INFRASTRUCTURE.md`, `ops/README.md`, Dockerfiles/Compose preserved. Public topology/redeploy/restart/settlement-safe deployment still needs hosting-specific sign-off |
| 3. Capacity | `Evidence/capacity_checkout_load_test.md` retained: method, fixed scenario, resource caps, estimate/measured results and overload discussion. No rerun or new capacity claim |
| 4. Findings report / shared root causes / decisions and open risks | `Evidence/bugs/`, implementation/PMA/audit reports and ADRs retained. Existing-data effects remain qualified by each report |
| 5. UI and UX changes | UI/checkout/features evidence and three desktop/mobile screenshots preserved. A complete paired before/after set and recordings were not established |
| 6. AI usage | AGENTS.md, CLAUDE.md, cursor configuration, context and helper scripts preserved. Three correctly annotated transcript excerpts, including an AI mistake, were not located/validated as a final submission section |
| Refund demo in recommended slides | Refund source/regressions/evidence retained. Full/partial refund with correct dashboard/settlement values and backup screenshots not rerun or certified here |
| Running deployment throughout judging | Local endpoints reachable only; four public URLs, HTTPS and judging-period uptime unverified |

The submission PDF must keep the exact ordered headings from the guidelines:
Cover page; 1. Summary; 2. Architecture and deployment; 3. Capacity;
4. Findings report; 5. UI and UX changes; 6. AI usage; optional Appendix.
Do not replace missing team evidence with invented results.

## Issue status, remaining risks and readiness

RELEASE-TEST-01 (P2), unsafe default/configured-DB test invocation:
`confirmed-current` -> `fix-verified` for supported npm entrypoints. Source proof:
API/Go global-counter mutations and reporting rebuild truncate; baseline wiring
test failed and final preflight/default checks pass. Existing database effects
were not assessed because no write tests were executed.

Workstream issue counts after cleanup: historical-report 0, confirmed-current 0,
already-fixed 0, duplicate 0, stale-or-invalid 0, unverified 0, fix-verified 1.
These are **not** a recount of the historical BUG registry or a claim that no
important application defects remain. Submission checklist gaps are listed
separately above. No historical bug status was changed.

Readiness: **safe local build/static cleanup verified; production deployment and
final submission sign-off incomplete**. Compose remains explicitly development
configuration with fixture DB credentials, shared DB role, host Vite frontends,
no restart policy/resource caps and no established production host. No changes
were made to deployment/financial behavior. Actual Go module minimum is 1.22 and
Docker uses 1.23, differing from AGENTS' 1.24 prerequisite. Some context still
contains historical bug/status snapshots; fresh observations here take priority
only for this workstream. ADR 0003/0004/0006 and HANDOVER accounting conflicts
remain open human questions; ADR 0005 stays paused.

Source inspection also corrected an operations-documentation discrepancy:
current Go config ignores `PGCONN_SETTLEMENT` and supports explicit
`SETTLEMENT_DATABASE_URL`; stale docs claimed the reverse. The release preflight
rejects both alternative settings. No runtime precedence was changed. A second
read-only agent reviewed the final test wiring and found no blocking defects.

Before the deadline, the team must verify its public fork/final published commit,
complete both named PDFs and cover-page URLs, confirm existing public deployment
health/HTTPS/uptime and settlement-safe restart policy, and check refund demo,
before/after screenshots and annotated AI excerpts using retained evidence.
Any further financial verification needs a separately authorized isolated test
environment. No production deployment or real financial operation is required
or authorized by this cleanup report.

## Files changed and context maintenance

- `.gitignore`; deleted duplicate `.webhook-typecheck.log`.
- `package.json`, `apps/api/package.json`, `apps/reporting/package.json`:
  safe default and explicit preflight test commands; dependencies unchanged.
- `scripts/test-unit.mjs`, `ops/test-database.mjs`,
  `ops/test-database.test.mjs`: audited allowlist, destination preflight and regressions.
- `ops/README.md`: safe commands, quarantine limits and deployment distinction.
- `context/TESTING.md`, `INFRASTRUCTURE.md`, `DEPENDENCY_MAP.md`,
  `DECISIONS.md`, `KNOWN_ISSUES.md`, `CHANGELOG.md`, and module context for
  scripts/ops, API, reporting, settlement: reviewed and refreshed test behavior,
  dependencies, checks and remaining limits. Runtime architecture is unchanged;
  no separate architecture rewrite was needed.
- This report and `Evidence/implementation/release-file-provenance.tsv`.

No runtime interface depends on a changed API shape or schema; only developer
test commands and context are affected. No changes were committed, staged,
merged, rebased, pushed or deployed.
