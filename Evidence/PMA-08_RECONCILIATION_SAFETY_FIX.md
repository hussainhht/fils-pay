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
