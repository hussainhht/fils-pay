# PMA-08 / BUG-033 - retired reconciliation safety fix

Date: 2026-10-30 (Asia/Bahrain). Baseline HEAD: `c3eb21830dd133a47e86bf5f9150a3ba8f9caffd`, branch `main`.

## Executive summary and status

**VERIFIED_FIXED** for prevention of future execution through `scripts/reconcile_march.ts`. The baseline defect was statically confirmed: the retirement warning was a comment; direct execution still connected to Postgres and unconditionally posted adjustments with fresh UUIDs. All database and posting implementation has now been removed. Direct CLI execution prints a clear refusal and exits 1; import is silent and exposes only two historical pure helpers. There is no environment-variable bypass or replacement financial poster.

**STILL_OPEN / unverified** for historical financial impact. Repository narratives suggest earlier execution, but no database-level investigation was possible. No financial correction was performed, and this report does not certify existing ledger integrity.

Issue tracking for the one issue in this workstream: before `confirmed-current` (P1), after `fix-verified`. After-status counts: `fix-verified` 1; `historical-report`, `confirmed-current`, `already-fixed`, `duplicate`, `stale-or-invalid`, `unverified` each 0. Historical-data uncertainty is a limitation of this issue's resolution, not a second status assigned to BUG-033. Registry-wide counts and unrelated defects were not re-audited.

## Environment and scope

Windows PowerShell; Node v22.19.0; npm 10.9.3; Go 1.24.2 windows/amd64. Docker command is unavailable. `DATABASE_URL` is unset and `ops/.env.docker` does not exist. No identified disposable or explicitly authorized read-only database was available, so no database connection, migration, seed, or financial query was attempted. API/web/admin boot, health/readiness, auth, and end-to-end payment flows were not verified for this narrowly scoped retirement change.

The working tree already contained substantial unrelated authentication/UI/config/package/context work and an untracked audit report and migration `0085_authenticators.sql`. These were treated as other work in progress and preserved. Some shared context documents continued changing during this task; edits here were narrow replacements or appended sections. No commit, merge, reset, branch switch, push, dependency installation, schema change, or edit to `packages/money/` was performed.

## Claim, root cause, and exact affected paths

Baseline source path and line references:

- `scripts/reconcile_march.ts:3-12`: DO NOT RUN warning without runtime enforcement.
- `:19-20`: `monthBounds` uses UTC March, not Bahrain month boundaries.
- `:31-32`: `computeResidueFils` returns `capturedFils % 10`.
- `:41-54`: `fetchResidueRows` selects positive transaction-level captured totals with nonzero modulo residue by transaction `occurred_at`; casts BIGINT strings to JavaScript numbers.
- `:59`: `groupByMerchant` sums transaction residues by merchant.
- `:75`: `postResidueCorrection` generates `randomUUID()` and inserts debit `merchant_payable` / credit `scheme_rounding_residue`, with no stable operation identity, existence predicate, or idempotency key.
- `:87`: `main` reads configuration, constructs/connects `Client`, fetches rows before BEGIN, posts each merchant inside a transaction, commits, and disconnects. It has no dry-run mode.
- `:133`: direct-module guard invokes `main`; importing the original did not call main, but loaded the database dependency and retained the dangerous CLI implementation.

Source-to-sink: local operator invokes CLI with a writable database URL -> March transaction selection -> merchant aggregation -> fresh group identity -> unconditional ledger INSERT -> COMMIT. No remote unauthenticated exploit or attacker control over the database is alleged. The primary trigger is an authorized operator following unsafe historical instructions, including a purported rerun or dry run. The script remained executable because the prior remediation changed comments only.

The exported arithmetic is mathematically correct only for the residue of one nonnegative captured total. It is not a verified financial reconciliation calculation: transaction aggregates need not match capture/export lines, refund effects are not reconciled, the accounts/directions differ from ADR 0002, selection uses transaction time rather than effective export scope, and postings are dated at execution time. BIGINT-to-number conversion also lacks a safe-integer check. These defects were removed from the executable path rather than redesigned.

## Repeat-execution proof and safeguards checked

For merchant M with unchanged selected data and residue R > 0, run 1 inserts group G1 with payable debit R and residue credit R. Run 2 generates G2 independently and inserts the same amounts again. Each group nets R - R = 0, so both pass the balance trigger. After k successful runs, payable debits from this script total kR; excess versus one run is (k - 1)R. Sequential reruns alone suffice; a race condition is not required. A failed/rolled-back run is not evidence of a duplicate, and zero matching residue causes no posting.

`db/migrations/0007_ledger_double_entry.sql` defines a row primary key and a nonunique group identifier, with a deferred per-group balance trigger. There is no unique business-operation key or description constraint preventing this insert. `0079_ledger_audit_immutability.sql` prevents UPDATE/DELETE, not repeated balanced INSERTs. The transaction ensures all-or-nothing for a run but does not deduplicate runs. Merchant/account foreign keys and positive amounts do not prevent duplicates. Static review of ledger-related migrations found no later protection for this description/operation.

Verification used the fp-check standard checklist. Reachability, conditional flow, trusted data provenance, database API/constraints, impact, and environment were traced in current baseline source. Counterarguments were checked: the warning is not enforcement; balanced groups are not unique operations; a fresh UUID does not identify the same business event; BEGIN/COMMIT does not imply idempotency; import guarding does not retire direct execution; and no actual dry-run branch exists. Bounds/TOCTOU/concurrency and memory-corruption claims are not needed. Verdict: **TRUE POSITIVE financial-integrity defect (1); false positives (0)**. This is a financial duplicate-posting finding, not a claim of RCE, privilege escalation, or information disclosure.

## References, retirement history, and supported workflows

Read `AGENTS.md`, `CLAUDE.md`, task-routed context, PMA-08, canonical BUG-033, `Evidence/implementation/agent-4-settlement.md`, financial architecture, ADR 0001/0002/0003, relevant ledger migrations, tests, and current Go settlement code. Historical agent instruction directories were not read.

The earlier settlement implementation report and `Evidence/bugfix_plan.md` explicitly say not to run this script: its formula/accounts differ from scheme residue, and BUG-034 only fixes new closes. That explains retirement; comments alone did not implement it. The canonical bug's prior "Fixed" label overstated protection.

Targeted reference searches covered package scripts, source imports/callers, ops/Docker entrypoints, hidden automation files, docs, context, and evidence, excluding the prohibited historical instructions and dependency/Git directories. No checked-in active package, CI, or scheduled invocation was found. Only the existing arithmetic and synthetic integration tests import the module; no runtime workflow reuses its poster. The root test glob runs these tests, not the CLI. External scheduler configuration is outside repository visibility.

The dangerous current runbook instructions to copy/run the script and its false description-deduplication claim were removed. Historical meeting notes and ADR records were retained as evidence. Useful original code remains in baseline Git at the same path; no executable archive was introduced.

Supported `apps/settlement/internal/settlement/batch.go` remains unchanged. `CloseBatch` checks batch state and freezes scheme lines, then posts `gross_fils - truncated` per export line as credit `card_scheme_clearing` / debit `scheme_rounding_residue` inside its transaction. It does not import the retired TS script. Earlier context claiming this Go posting code did not exist was stale and was corrected. No already-closed March batch is automatically backfilled. ADR 0003's UTC/Bahrain conflict and ADR 0004/0006/HANDOVER accounting tensions remain human policy questions; no accepted decision was edited or resolved here.

## Protective change and files modified by this workstream

- `scripts/reconcile_march.ts`: remove crypto/pg/money imports and all fetch/group/post/main implementation; retain unchanged pure `monthBounds` and `computeResidueFils`; explicit CLI refusal and exit 1.
- `scripts/reconcile_march.retirement.test.ts`: new static and guarded process tests.
- `docs/RUNBOOK.md`: retire unsafe operating instructions.
- `Evidence/bugs/bug-033-march-sweep-not-idempotent.md`, `Evidence/bugs/Readme.md`: correct status and distinguish historical-data uncertainty.
- `context/modules/scripts-and-ops.md`, `context/modules/apps-settlement.md`, `context/ARCHITECTURE.md`, `context/DEPENDENCY_MAP.md`, `context/DECISIONS.md`, `context/REPOSITORY_MAP.md`, `context/CONTEXT_STATUS.md`, `context/KNOWN_ISSUES.md`, `context/TESTING.md`, `context/CHANGELOG.md`: update affected navigation, dependency, behavior, status, and verification descriptions while preserving unrelated work.
- This report.

No financial tables, records, balances, migrations, supported settlement source, or partner API were changed by this workstream. This describes actions taken; it is not an assertion based on before/after database snapshots.

## Regression tests and exact verification outcomes

1. `node --import tsx --test --test-name-pattern='retired entrypoint has no database' scripts/reconcile_march.retirement.test.ts` against original source: exit 1, 1 test failed as expected; the import capability check found crypto/pg/money dependencies. It read source only.
2. Full focused suite before the replacement was successfully written: 6 tests, 3 passed / 3 failed. CLI/import children hit the loader's `FORBIDDEN_DATABASE_IMPORT` before pg evaluation; historical posting logic did not run. A Python-based write attempt failed because python.exe was inaccessible and changed nothing; replacement was then written with PowerShell/.NET. An intermediate fixed-source test failed because its regex matched the English word "require" in the refusal text; the assertion was corrected to detect an actual require call.
3. Final `node --import tsx --test scripts/reconcile_march.test.ts scripts/reconcile_march.retirement.test.ts`: exit 0, **6 passed, 0 failed, 0 skipped**. Covers no database/posting capability, four CLI invocations (twice each with missing and synthetic configuration), silent import with only historical helper exports, automation/package-script scan, and the two unchanged arithmetic tests. Children preload a hook refusing pg resolution before a client can be created. No real financial data is used.
4. `npm.cmd run typecheck`: exit 0 across all npm workspaces, db and scripts; passed both before and after final code/test changes.
5. `go test ./... -v` in `apps/settlement`: initial default-cache attempt failed with access-denied errors in the user Go cache. Retried with `$env:GOCACHE = Join-Path $env:TEMP 'filspay-pma08-go-cache'`: **exit 0**, available unit tests pass, database-backed tests explicitly SKIP because DATABASE_URL is absent. Bahrain-window, scheme truncation/formatting, money, config, HTTP validation/auth, and split tests ran. Skipped CloseBatch/export/rebuild tests are **not verified** by that exit status.
6. `git diff --check`: exit 0 (CRLF normalization warnings only); final scoped diff reviewed. No unrelated files were deliberately edited. Existing and concurrently appearing changes remain outside this workstream.

The DB-backed `scripts/reconcile_march.integration.test.ts` was **not run**, rather than weakened or skipped in code. Its synthetic temporary-table arithmetic test remains intact. Root/API/reporting database suites and end-to-end financial operations were not run. Tests do not execute the historical posting logic.

## Existing financial data evidence and limits

- `docs/ONBOARDING.md` says finance ran a March one-off producing 13 lines / 0.070 BD and refers to `scripts/out/`. That output directory is absent in this checkout.
- `docs/meetings/2026-07-08-finance-eng.md` says a July 3 "dry run" produced the same 13 lines / 70 fils, and reports an unresolved roughly 4.7-4.8 BD gap. Baseline code has no dry-run mode. The narrative is suspicious but does not establish that the writable entrypoint committed against any particular database.
- `docs/archive/slack-export-fp-finance-2026-09.txt` mentions the March discrepancy and a roughly 4.75 BD gap on September 23. It provides no ledger operation IDs proving a duplicate sweep. August import duplicates discussed there are a different operation and were not attributed to this script.
- Root `CHANGELOG.md` claims March ties out; the later meeting/finance narratives contradict that. ADR 0002's March deployment story also differs from the earlier implementation investigation. Neither narrative certifies balances.
- Migration 0038/revert history is mentioned in incident narratives; it does not prove script invocation or explain the gap by itself. The script's random group IDs, free-text description, and runtime timestamps do not carry a stable March operation identity or structured audit/outbox evidence.

No duplicate historical ledger entries were confirmed and no exact financial loss is asserted. If the reported 70-fils run were committed twice over unchanged inputs, the additional payable debit would be 70 fils (0.070 BD); that conditional example does not explain or verify the reported 4.75 BD discrepancy.

## Safe read-only detection query for separate authorized investigation

Not executed. Run only after identifying and authorizing a database, preferably with a SELECT-only role or verified disposable snapshot. This identifies groups matching the legacy signature and flags repeated equal amounts for review; equal amounts alone are not proof of duplication. It also shows single candidates so prior postings can be reconciled before any repair. Description variants, partial historical evidence, and changed source data require further investigation.

```sql
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
WITH legacy_groups AS (
  SELECT merchant_id, entry_group_id,
         MIN(occurred_at) AS posted_at,
         MIN(created_at) AS recorded_at,
         SUM(amount_fils) FILTER (
           WHERE account_id = 'merchant_payable' AND direction = 'debit'
         ) AS payable_debit_fils,
         SUM(amount_fils) FILTER (
           WHERE account_id = 'scheme_rounding_residue' AND direction = 'credit'
         ) AS residue_credit_fils,
         COUNT(*) AS leg_count
    FROM ledger_entries
   WHERE description LIKE 'March 2026 scheme rounding residue sweep%'
   GROUP BY merchant_id, entry_group_id
)
SELECT *,
       COUNT(*) OVER (
         PARTITION BY merchant_id, payable_debit_fils, residue_credit_fils
       ) AS same_amount_groups_to_review
  FROM legacy_groups
 ORDER BY merchant_id, recorded_at, entry_group_id;
COMMIT;
```

Do not limit `occurred_at` to March: the legacy poster used its run time, potentially July or later. Validate candidates have exactly the expected legs and compare capture/export/refund evidence, operation timing, and approved finance records. If duplicates are verified, finance must approve a distinct remediation design specifying correct scope, amounts/accounts/effective dates, stable idempotency identity, exclusions for existing residue postings, audit/outbox behavior and independent review. Any authorized correction must preserve the original records. This task authorizes no reversal, deletion, balance rebuild, or historical adjustment.

## Remaining risks and final disposition

Future posting through the current retired entrypoint is blocked and tested: **VERIFIED_FIXED**. Historical correctness remains **STILL_OPEN**, with database investigation **BLOCKED** by the absence of an identified authorized database. Supported reconciliation runtime is unverified at database level; its source is unchanged and available unit tests pass. Archived checkouts/copies and external automation cannot be disabled by changing this repository. No reactivation or historical repair is implied by this closure.

---

## Independent local validation preserved during rebase

The preceding report was committed upstream in `93d4c77`. The following report records the independent local investigation at baseline `1c3f99e`; its environment and command outcomes refer to that run. Both investigations retired the same posting path. The combined tree retains the upstream entrypoint and both retirement test suites. Historical statements about uncommitted files describe those original runs.

# PMA-08 / BUG-033 — Reconciliation safety fix

Date: 2026-10-30 (Asia/Riyadh). Baseline HEAD:
`1c3f99e0c5478e1ff616898cdfc1cd6f5283172d`, branch `main`.
Initial worktree: clean. Git required a command-local `safe.directory` override
because the sandbox user differs from the repository owner; no Git config changed.

## Executive summary and final status

**VERIFIED_FIXED** — prevention of future financial execution through the retired
`scripts/reconcile_march.ts` entrypoint. Canonical BUG-033 status moved from the
source-confirmed `confirmed-current` defect to `fix-verified` (P1). The bug report
and index previously said “Fixed” for a warning-only header; that claim was false.
Direct execution now prints an explicit retirement error and exits 1. All database
and posting code is removed. Imports expose only historical pure test helpers.
There is no environment-variable bypass and no replacement adjustment script.

**STILL_OPEN** — historical financial impact investigation/correction. No database
was accessed, and no existing entries were changed. This report does not certify
historical data integrity. Historical correction requires separate approval.

Task-scoped registry counts: `fix-verified` 1; `confirmed-current`,
`historical-report`, `already-fixed`, `duplicate`, `stale-or-invalid`, `unverified`
0 each. No newly confirmed independent defect was found; the runbook and false
retirement status are included under BUG-033, not assigned duplicate bug numbers.
This is not a reclassification of the rest of the bug registry.

The requested `Evidence/POST_MERGE_AUDIT_REPORT.md` (PMA-08 text) is absent in this
checkout. Its contents could not be verified. The canonical BUG-033 report,
`Evidence/implementation/agent-4-settlement.md`, current code, schemas, ADRs, and
historical finance documents independently establish the defect.

## Root cause and affected paths (baseline line numbers)

The script was retired in comments only. Its executable shebang and guarded
`main()` invocation remained functional. Given a usable DATABASE_URL, database
permissions, and matching positive-residue March transactions, it connected and
posted financial adjustments. `--dry-run` was not parsed and offered no protection.

| Path | Original behavior |
|---|---|
| `reconcile_march.ts:18-21` | Imported random UUID generation, `pg.Client`, and money formatting |
| `monthBounds`, `fetchResidueRows` | UTC `[2026-03-01, 2026-04-01)` query on transaction `occurred_at`; selects positive cumulative `captured_fils` with remainder |
| `computeResidueFils`, `groupByMerchant` | Converts BIGINT strings to JS numbers; sums `captured_fils % 10` per merchant |
| `postResidueCorrection` | Fresh `randomUUID()` per merchant on every run; directly inserts debit `merchant_payable` and credit `scheme_rounding_residue` |
| `main` | Connects, fetches rows, begins a transaction, posts all merchants, commits, logs success; closes client |
| Bottom CLI guard | Calls `main()` on direct execution; warning header is never enforced |

There was no stable business-operation identifier, posting-existence check,
idempotency-key lookup, uniqueness conflict handler, or reconciliation lock.
The constant description was not checked. The source transactions were not marked
as reconciled or linked to the postings. `transaction_id` and `settlement_batch_id`
were omitted from inserted ledger rows. No outbox or admin audit row was written.
Transaction rollback protected against partial failure, not successful reruns.
Importing at baseline did not invoke `main`, but eagerly loaded DB dependencies;
the fixed module has neither those dependencies nor any callable poster.

### Why database safeguards do not deduplicate

`db/migrations/0007_ledger_double_entry.sql` defines `ledger_entries.id` as a
BIGSERIAL primary key. `entry_group_id` is non-unique, intentionally shared by
multiple legs. Its deferred balance trigger checks only equal debits and credits
within a group. Both the original pair and a repeated pair balance independently.
Foreign keys and positive-amount checks also accept both. Migration 0079 prevents
UPDATE/DELETE, not duplicate INSERT operations. Inspection of ledger references in
all migration files found no stable reconciliation-operation constraint.

If merchant remainder total is R > 0, N successful runs over unchanged matching
data debit merchant payable by N*R and credit residue by N*R. Relative to one run,
the repeated amount is (N-1)*R; even the first run uses the wrong accounting model.
Concurrent runs can have the same effect. Changed captures between runs produce
different totals, so equal-amount matching alone cannot detect every repeat.

### Amount, account and period correctness

Modulo 10 is the truncated remainder of one nonnegative integer. It is not proof
of a correct reconciliation: the script uses cumulative transaction captures,
not actual frozen scheme lines/capture events; does not reconcile refunds or
existing residue entries; and converts BIGINT to potentially imprecise JS numbers.
For example, separate scheme lines of 6 and 6 fils have 12 fils total residue,
while the transaction aggregate 12 yields 2. The script also debits merchant
payable rather than crediting card scheme clearing, credits rather than debits
residue, and dates corrections at runtime rather than the effective March period.

ADR 0002 specifies per-line `gross_fils - amount_fils`, credit
`card_scheme_clearing`, debit `scheme_rounding_residue`. Current
`apps/settlement/internal/settlement/batch.go:301-325` implements this for new
closes. Its batch row lock and closed/paid no-op path are at lines 89-126.
There is no dependency on the retired script. Historical context and older reports
claiming no Go residue posting exists are stale at the baseline HEAD.

UTC March excludes Bahrain March 1 00:00–03:00 and includes Bahrain April 1
00:00–03:00. ADR 0003 explicitly chooses UTC monthly windows, conflicting with
business-day reconciliation. ADRs 0003/0004/0006 and HANDOVER conflicts remain open
human policy questions; this fix makes no new financial policy and edits no ADR.
ADR 0005 remains paused.

## Protective implementation and invocation review

- Removed `fetchResidueRows`, `groupByMerchant`, `postResidueCorrection`, `main`,
  `ResidueRow`/internal posting types, SQL, DB configuration access and DB imports.
- Direct CLI invocation only emits a fixed retirement message and sets exit 1.
  Supplied arguments and environment cannot re-enable posting.
- Preserved `monthBounds` and `computeResidueFils` unchanged for existing unit and
  synthetic integration tests. They carry no financial I/O. Historical posting
  implementation is preserved in Git at the baseline HEAD, not as another runnable
  archive. The source comment points to that commit and this report.
- Replaced `docs/RUNBOOK.md` instructions to copy/run the script against production
  and its false “description check” claim. The runbook now points to frozen scheme
  exports and separate historical review, with no replacement financial writer.
- Searched root/workspace package scripts, scripts, ops, Dockerfiles/Compose,
  documentation and repository automation filenames. No scheduled or package CLI
  invocation was found; `.github` is absent. Only the existing helper tests import
  this module. Root test automation discovers tests, not the retired CLI.
- No external scheduler configuration, previously copied scripts, old checkout,
  production deployment, or infrastructure outside this repository was available
  for inspection. The code change cannot disable those independent artifacts.

## Regression evidence and commands

Environment: Windows PowerShell; Node v22.23.2, npm 10.9.8, Go 1.23.1 (installed
version differs from AGENTS' recommended 1.24; current go.mod declares 1.22).
Dependencies already installed. `ops/.env.docker` exists; values were not printed
or used. DATABASE_URL is unset. Docker client cannot access its config/daemon
from the sandbox. No verified disposable or authorized read-only DB was available.

| Command / inspection | Actual result |
|---|---|
| `git status --short`, `rev-parse HEAD`, `branch --show-current` with command-local safe.directory | Clean baseline; HEAD/branch above |
| Read AGENTS, CLAUDE, routed context, full script, canonical bug, finance history, architecture, ADRs 0001–0003 and decision summaries | Defect statically confirmed; stale documentation identified |
| `node --import tsx --test scripts/reconcile_march.safety.test.ts` before implementation | 3 failures, 1 pass; DB loader trap fired before evaluation, no legacy financial logic executed |
| Same safety test after implementation | 4 passes |
| `node --import tsx --test scripts/reconcile_march.safety.test.ts scripts/reconcile_march.test.ts scripts/expire_holds.test.ts scripts/expire_holds.new.test.ts scripts/lib/sqlFilter.new.test.ts` | 11 passed, 0 failed, 0 skipped |
| `npm.cmd run typecheck` | Passed all workspace, db and scripts checks |
| `go test -v ./...` in `apps/settlement` | Exit 0; runnable tests pass, DB-backed tests explicitly skip without DATABASE_URL |
| March synthetic DB integration, API/reporting DB suites, supported batch DB integration | NOT RUN / not verified against a database |
| Full app runtime / DB readiness / auth / payment journeys | NOT RUN; outside isolated retirement validation and no verified DB |

The first sandbox tsx attempt failed in Windows `uv_os_get_passwd` before tests;
the first Go attempt failed on build-cache access. Approved execution outside the
sandbox succeeded. Go downloaded its declared existing modules; no dependency
manifest or lock file was changed.

The new safety tests deny `pg` resolution in subprocesses before module evaluation.
They prove configured/unconfigured direct execution and a repeated `--dry-run`
attempt exit 1 with the retirement message, no stdout, and no pg resolution. Import
exits 0 silently and exposes only the two pure functions. Source checks confirm
the removed DB/posting path, and package/ops checks detect a reintroduced caller.
This is prevention evidence, not a run of legacy SQL. Existing test assertions were
not weakened, skipped, or removed.

## Historical data evidence and limitations

- `docs/ONBOARDING.md:86-90`: reports a March run matching 13 lines, 70 fils;
  refers to output in `scripts/out/`, which is absent from this checkout.
- `docs/meetings/2026-07-08-finance-eng.md:16-24`: reports a July 3 “dry run” with
  the same 13 lines / 70 fils and says rerunning is safe. Baseline script has no
  dry-run facility, so this is evidence warranting investigation, not proof of a
  committed second run or of which database/version was used.
- `docs/archive/slack-export-fp-finance-2026-09.txt`: describes an August sweep
  and a continuing March discrepancy around 4.75 BD. No August variant or referenced
  run logs are present. Do not attribute the full discrepancy to BUG-033.
- Canonical BUG-033 mentions a “gap doubled on staging” clue, without raw ledger
  rows or operation IDs proving it. No verified financial correction is inferred.
- Migration 0038's header records removal of an older `amount_3dp` migration;
  it does not establish a sweep run or explain the financial discrepancy.
- `docs/incidents/postmortem-2026-05.md` concerns payment-link duplicate captures,
  not this sweep; it supplies no evidence of March reconciliation execution.

A repeated unchanged 70-fil sweep would add another 70-fil merchant debit and
70-fil residue credit (not 140 fils of independent economic loss). The logs count
source transactions, not necessarily ledger groups or legs. Actual amount,
merchants, dates, affected environment and number of committed runs are unknown.
Historical statements are leads, not a database audit.

### Read-only detection query (provided, NOT executed)

Use only after verifying an authorized target and read-only access. Match on the
description prefix rather than March posting dates because baseline used runtime
timestamps. First inspect every candidate group, including malformed or partial
matches; then compare the complete ledger, batch links, scheme statements and
operator records. No data-changing SQL is supplied.

```sql
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

WITH candidates AS (
  SELECT merchant_id, entry_group_id,
         min(created_at) AS first_created_at,
         min(occurred_at) AS effective_at,
         count(*) AS leg_count,
         bool_and(transaction_id IS NULL AND settlement_batch_id IS NULL) AS unlinked,
         count(*) FILTER (WHERE account_id = 'merchant_payable'
                           AND direction = 'debit') AS payable_legs,
         count(*) FILTER (WHERE account_id = 'scheme_rounding_residue'
                           AND direction = 'credit') AS residue_legs,
         sum(amount_fils) FILTER (WHERE account_id = 'merchant_payable'
                                   AND direction = 'debit') AS payable_debit_fils,
         sum(amount_fils) FILTER (WHERE account_id = 'scheme_rounding_residue'
                                   AND direction = 'credit') AS residue_credit_fils
    FROM ledger_entries
   WHERE description LIKE 'March 2026 scheme rounding residue sweep%'
   GROUP BY merchant_id, entry_group_id
)
SELECT *, count(*) OVER (
           PARTITION BY merchant_id, payable_debit_fils, residue_credit_fils,
                        leg_count, payable_legs, residue_legs, unlinked
         ) AS matching_group_count
  FROM candidates
 ORDER BY merchant_id, first_created_at, entry_group_id;

ROLLBACK;
```

The legacy signature is two unlinked legs, one payable debit and one residue
credit of the same positive amount. `matching_group_count > 1` flags possible
duplicates, not authorization to reverse anything. Different totals on reruns,
modified descriptions, copies for other months, or extra legs sharing the group
are not fully characterized by this query. A zero-row result cannot certify
historical integrity. Full group inspection must also read any legs outside the
description filter before deciding the economic effect.

Any correction requires separately approved investigation of source statements,
complete group identities, authoritative amounts/accounts/effective dates,
finance review, an audited append-only correction design, and isolated validation.
No amount or correction policy is chosen here.

## Files changed and final review

- `scripts/reconcile_march.ts`: fail-closed retirement, historical pure helpers.
- `scripts/reconcile_march.safety.test.ts`: isolated prevention regressions.
- `docs/RUNBOOK.md`: remove dangerous retired-script instructions.
- `Evidence/bugs/bug-033-march-sweep-not-idempotent.md`, `Evidence/bugs/Readme.md`:
  correct current BUG-033 status; retain original vulnerability evidence.
- This evidence report.
- `context/modules/scripts-and-ops.md`, `context/DEPENDENCY_MAP.md`,
  `context/ARCHITECTURE.md`, `context/DECISIONS.md`, `context/KNOWN_ISSUES.md`,
  `context/TESTING.md`, `context/CHANGELOG.md`: retirement behavior, dependencies,
  source/document contradictions, actual checks and limitations.

No ledger records, balances, schema, migrations, money implementation, partner
contract, or supported settlement source changed. No SQL was executed, no DB
connection was initiated, and no financial operation was performed by this task.
Final code, test and documentation diffs reviewed: only the 13 files listed above
changed (11 tracked modifications and 2 new files). `git diff --check` passed with
exit 0; Git emitted only an LF-normalization advisory for the script. Final script
test rerun: 11 passed, 0 failed, 0 skipped. Final full typecheck rerun: exit 0.
No commit, merge, branch change or push performed.
