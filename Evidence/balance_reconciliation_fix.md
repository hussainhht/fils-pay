# Balance / Settlement Reconciliation Fix (FP-203 + split residual fils)

## 1. Baseline

- HEAD `d6e6bbbb03b6bf45ef45163c55f20dea6cc16fca`, branch `main`.
- Pre-existing uncommitted work by others (not touched): AGENTS.md, `apps/api/src/{admin,auth,paymentLinks,payments,reporting,routes}/*` (17 modified files), untracked `.cursor/`, `CLAUDE.md`, `Evidence/agent-1..3-*.md`, `apps/api/src/reporting/scope.new.test.ts`.
- Environment: Go 1.24.2 present. **No Docker, no psql/Postgres, `DATABASE_URL` unset** → all DB-backed tests and all runtime checks (AGENTS.md §4 steps 3–8) were **not run**.

## 2. Status

| Issue | Status | Evidence |
|---|---|---|
| FP-203 (Recalculate cached balances wrong source) | **CONFIRMED** (static) → fixed, DB tests not run | `apps/settlement/internal/internalapi/server.go` `handleRebuildBalances` called `ledger.RefreshBalanceCache` (`ledger/refresh.go`, deleted), which read view `merchant_payable_position` (`db/migrations/0054_views.sql:3-8`: `SUM(scheme_export_lines.amount_fils)` per merchant, all batch statuses, lifetime gross, no fees/payouts/refunds). The CLI (`main.go:141-166`) calls `ledger.RebuildAllBalances` (`ledger/rebuild.go`), which sums `ledger_entries` where `account_id='merchant_payable'`. |
| Settlement split shortfall | **CONFIRMED** (reproducible without DB) → fixed, verified by unit tests | `splits/shares.go` (and `allocate.go`) computed each child with `ApplyRateFils` (banker's rounding per child), so shares do not sum to net payout. Example 1001 fils over 3333/3333/3334 bps gave 334+334+334 = 1002 (+1); other inputs come up short. The old test only used clean numbers. Migration comment (0045) records FP-250 as left unfixed. |

They are **different root causes** (wrong read source vs. per-child rounding).

## 3. Root cause and source-of-truth decision

- Canonical source: `ledger_entries` (`merchant_payable` credits − debits). `docs/ARCHITECTURE.md` ("`ledger_entries` is the record of money movements"), `docs/HANDOVER.md` ("no console button, and there shouldn't be one that reads anything else"), `internal/balances/cache.go` header ("ledger_entries remains authoritative"), `apps/api/src/admin/credits.ts:177`, and the CLI all agree. `merchant_balances` is a cache.
- **Open ADR conflict for a human (AGENTS.md §2):** ADR-0004 (accepted) says the console rebuilds from settled data; ADR-0006 says adjustments are cache-only and a rebuild wipes them. The fix follows the code/ARCHITECTURE/HANDOVER, not ADR-0004. ADR text was not edited; a superseding ADR is a human decision. Consequence unchanged from ADR-0006: Adjust-balance corrections are still overwritten by a rebuild.
- Concurrency: `RebuildAllBalances` carried `TODO: lock merchant_balances rows first, a concurrent CloseBatch increment gets clobbered`. Fixed by ensuring the row exists and taking `SELECT … FOR UPDATE` on it before the ledger sum. Incremental writers (`ApplyBatchClose`/`ApplyPayout`) take the same row lock, so each concurrent writer either commits before the recompute (ledger legs visible; READ COMMITTED statement snapshot) or applies its delta on top of the rebuilt value.
- Split rule: no new policy. Uses the already-approved largest-remainder method (ties → ascending index) from `packages/money` `allocateRemainder`, ported into `internal/splits`. Weights that do not sum to 10000 bps (the invariant stated in migration 0045) are now **rejected** and the payout transaction rolls back, instead of posting a short/over payout.

## 4. Files changed

- `apps/settlement/internal/internalapi/server.go` — handler now calls `ledger.RebuildAllBalances`; comment.
- `apps/settlement/internal/ledger/rebuild.go` — row lock before recompute (resolves TODO); doc comment; dropped unused imports.
- `apps/settlement/internal/ledger/refresh.go`, `refresh_test.go` — **deleted** (the wrong-source implementation and tests asserting it).
- `apps/settlement/internal/splits/shares.go` — `ChildShares` now largest-remainder, returns `([]Fils, error)`.
- `apps/settlement/internal/splits/allocate.go` — uses `ChildShares`; refuses non-conserving payouts.
- Tests: `internal/splits/shares_test.go`, `internal/ledger/rebuild_test.go`, `internal/internalapi/server_test.go`.
- Not changed: `packages/money/` (**untouched**), `apps/settlement/internal/money/`, migrations (view `merchant_payable_position` left in place, now unused by Go), `apps/api/src/v1/`, auth/admin authorization, any TS file. No blocker arose in the protected module.

## 5. Before / after (fixture values)

- Splits (run, no DB): 1001 fils, weights 3333/3333/3334 → before 334/334/334 (=1002); after 334/333/334 (=1001), matching the TS `allocateRemainder` known-answer test.
- FP-203 fixture (encoded in tests, **not executed**): ledger credit 135000, payout debit 128000, scheme-export gross 135000. Old path would write 135000 (the lifetime gross); new path writes 7000 = CLI value. Endpoint test: capture 12000 − payout 5000: old 12000, new 7000.

## 6. Tests

Run (real results):
- `go vet ./...` — clean. `go build ./...` — ok.
- `go test ./...` in `apps/settlement` — all packages `ok`.
- `internal/splits`: PASS — `TestChildShares_SumToNet`, `…_LargestRemainderConservesExactly` (1001/3333-3333-3334, 100, one fil, zero, single child), `…_ConservesForEveryAmount` (every net 0..5000, no negative shares), `…_RejectsBadWeights`.

Written but **NOT RUN (skipped: no `DATABASE_URL`/Postgres; 9 DB tests skipped in `ledger` + `internalapi`)**:
- `TestRebuildAllBalances_FollowsLedgerNotSchemeExport` (cache == CLI == ledger, idempotent over two runs)
- `TestRebuildAllBalances_MerchantIsolationAndZeroActivity` (one fil, isolation, idle merchant → 0)
- `TestRebuildAllBalances_ConcurrentWithIncrementalWriter`
- `TestRebuildBalances_ValidToken` (updated to expect 7000 via the HTTP endpoint)
- Existing `TestRebuildAllBalances_OverwritesDriftedCache`.

Note: pending-vs-settled/reversal/hold inclusion needs no code decision here — the rebuild is the ledger sum, identical to the CLI; ledger posting semantics were not changed or re-audited. `npm run typecheck` / TS tests were **not run** (no TS changes; API tests need Postgres).

## 7. Runtime verification

None. No Docker/Postgres on this machine, so the stack, the admin button, the API balance read path and the settlement binary were not exercised. Auth/role checks on the admin route were not modified (the admin route files carry others' uncommitted edits) and not re-verified.

## 8. Remaining risks / follow-up

1. Run the Go DB tests against a migrated Postgres (`DATABASE_URL=… go test ./internal/ledger ./internal/internalapi`) before relying on the FP-203 fix; the concurrency test in particular is unproven.
2. Human decision: supersede ADR-0004/0006 (and the ADMIN.md wording). ADR-0006 still means Adjust-balance is wiped by a rebuild.
3. Rebuild now walks the full ledger inside an HTTP request (ADR-0004 cited ~40 s vs. a 30 s timeout). If that bites, make it a job — do not change the source (BUG-011 recommendation).
4. `ApplyPayout` for split parents passes `totalAllocated`; now always equal to `netPayout` (or the payout is refused), so the `am:` drift comment no longer applies. The 02:00 daemon refresh path was not inspected for another caller of the removed function (grep found none).
5. Zero-weight/zero-share children are still skipped in posting (ledger CHECK `amount_fils > 0`); with the remainder rule a child may legitimately receive 0 for tiny payouts.
6. Split-path DB integration (`PayoutSplitBatch`) is untested.
