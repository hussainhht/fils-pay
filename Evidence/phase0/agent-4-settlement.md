# Phase 0 — Agent 4: settlement verification

- Date: 2026-10-30 (Asia/Bahrain).
- HEAD: `c389b261c7b481c2b14d12374a5511a07e67f866` (`plan update`, 2026-10-30 13:49:47 +0300, `main`).
- Scope: BUG-010, BUG-011, BUG-030, BUG-031, BUG-032, BUG-033, BUG-034, BUG-035, BUG-036, BUG-037, BUG-063, BUG-064. Canonical reports and shared registries were not edited.
- Result: all twelve defects are still present. None are solved. Partial claims marked **STALE** below are narrower than the defect; they are not a reason to skip the fix.
- Method: current source and schema, ADR-0001 integer-fils rule, and local integer / IEEE-754 evaluation of the same expressions. No code, test, migration, or financial-data changes. March sweep was not executed. Compose was not started. HTTP was not used. BUG-011 was not re-demoed (plan already-proven list). BUG-050’s webhook disbursement was not re-demoed (existing runtime evidence). Old agent instructions were not read. Remediation below is proposed only.

Integer rule used as the requirement: `docs/adr/0001-integer-fils.md` (1 BD = 1000 fils, `BIGINT` / `money.Fils` int64, no float on money) and `packages/money/src/fils.ts:1-17` (integer fils only; the only 2-decimal figure is a truncation of integer fils at scheme export). Go `money.Fils` is `int64` (`apps/settlement/internal/money/fils.go:9-10`). `ApplyRateFils` / `applyRateFils` are half-to-even integer division by 10_000.

## BUG-010 — Net payout in float32

- **Status:** Critical; verified, OPEN. [Canonical report](../bugs/bug-010-net-payout-float32.md) matches HEAD. Not in the already-proven list; no runtime artifact (`findings.json` FINDING-002 is `NOT TESTED`). Reproduced here only as IEEE-754 evaluation of the expression, not as a settlement run.
- **Evidence:** `apps/settlement/internal/settlement/payable.go:10-12` converts both fils values through `float32`, divides by 1000, then `math.Round` back. `CloseBatch` freezes that result at `apps/settlement/internal/settlement/batch.go:219` into `net_payout_fils` (`:230-234`).
- **Integer check:** `float32` division then `round(float64(netBD)*1000)`, fee 0: `16777216` fils returns `16777217` (+1). `50000003` fils with fee `1250001` (exact net `48750002`) returns `48750004` (+2). Subtraction of the same `int64` fils is exact. Errors start at the 24-bit boundary; not every larger integer fails.
- **Existing evidence:** canonical report; plan Phase 4 one-line fix; FINDING-002.
- **Smallest fix:** `return grossFils - feeFils`.
- **Dependencies:** That net is what `PayoutBatch` posts (`batch.go:334-342`), what split allocation receives, and what `EnqueuePayoutNotifications` copies into `settlement.paid`. MDR recalc already uses integer `gross - newFee` (`recalculate_mdr.go:103`), so a recalc can replace a float net with an integer net when the fee changes (BUG-035).

## BUG-011 — Rebuild button reads scheme gross

- **Status:** Critical; verified, OPEN. [Canonical report](../bugs/bug-011-recalculate-balances-wrong-source.md) matches HEAD. Plan lists it as already proven; no re-demo. FINDING-005 is still `NOT TESTED` in `findings.json`; the proof used here is the source, not a new run.
- **Evidence:** `POST /internal/rebuild-balances` calls `ledger.RefreshBalanceCache` (`apps/settlement/internal/internalapi/server.go:122`, `:266-268`). That reads `merchant_payable_position` (`apps/settlement/internal/ledger/refresh.go:26`, `:62`). The view is `SUM(scheme_export_lines.amount_fils)` by merchant with no status, fee, payout, refund, or credit (`db/migrations/0054_views.sql:3-8`). The no-flag CLI calls `ledger.RebuildAllBalances` (`apps/settlement/cmd/settlement/main.go:162`), which sums `ledger_entries` for `merchant_payable` (`apps/settlement/internal/ledger/rebuild.go:102-106`) and writes `merchant_balances`. The view is referenced only from `refresh.go`.
- **Existing evidence:** canonical report; plan Phase 0 already-proven list and Phase 4 swap; FINDING-005. ADR-0004 is cover, not a second source of truth (see stale list).
- **Smallest fix:** `handleRebuildBalances` calls `RebuildAllBalances`.
- **Dependencies:** `--merchant` on the CLI calls `RebuildMerchantBalance` (`main.go:154-159`), which only returns the ledger sum and does not write the cache. That is BUG-067, outside this fix. Do not point the button at the single-merchant helper. ADR-0001 still requires the cache to be rebuilt from ledger fils, not truncated scheme gross.

## BUG-030 — Split shares do not conserve net

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-030-split-payout-missing-fils.md) mechanism matches HEAD. The universal “short / fils vanish” wording is **STALE**; independent half-to-even rounding both drops and fabricates fils.
- **Evidence:** `PayoutSplitBatch` gives each child `ApplyRateFils(netPayout, weightBps)` (`apps/settlement/internal/splits/allocate.go:90-99`). Shares `<= 0` are not posted (`:109-110`). The parent cache is debited by `totalAllocated`, not `netPayout` (`:134-138`). `packages/money` `allocateRemainder` has no Go caller. `ChildShares` (`apps/settlement/internal/splits/shares.go:11-16`) is the same per-child rate and is not called by `PayoutSplitBatch`. `SplitPayoutResult`’s comment that shares sum to `net_payout_fils` (`allocate.go:31-32`) is **STALE**.
- **Integer check:** half-to-even `amount * bps / 10000`. Net `1` fil, weights `3333, 3333, 3334` → shares `0, 0, 0`, posted `0` (1 fil dropped). Net `2` → shares `1, 1, 1`, posted `3` (1 fil fabricated). Across nets `0..5000` plus three larger nets and eight weight sets: 7798 short, 6964 over, 25270 exact.
- **Existing evidence:** canonical report; plan Phase 4; FINDING-026 (`NOT TESTED`).
- **Smallest fix:** largest-remainder allocation that sums to the net (port `allocateRemainder` for integer basis-point weights). Post the parent debit for the full net. Assign leftover fils before dropping a zero share, so a skipped `CHECK (amount_fils > 0)` leg cannot change the total.
- **Dependencies:** Webhook disbursement records batch `net_payout_fils`, not `totalAllocated` (handoff below). BUG-010’s float net is the input to this split. Fix conservation before treating the disbursement amount as equal to the ledger movement.

## BUG-031 — Platform volume is int32

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-031-platform-volume-int32-overflow.md) matches HEAD.
- **Evidence:** `platform_stats.total_processed_fils` is `INTEGER` (`db/migrations/0049_platform_stats.sql:7`). `ReadAndLockPlatformProcessedFils` scans `int32` (`platform_volume.go:13-17`). `RecordPlatformProcessedVolume` does `current + int32(batchGrossFils)` in Go and writes that value (`:25-29`), so PostgreSQL never sees the wide sum and cannot raise `22003`. `VolumeTierMdrBonusBps` pays 15 bps at `>= 2_000_000_000` (`:39-44`). Capture uses the same threshold (`apps/api/src/fees/platformVolumeTier.ts:4-8`, `:24-29`). The comment there that the column is `BIGINT` is **STALE**. The migration comments that `INTEGER` is plenty and that PostgreSQL `INTEGER` is 64-bit (`0049_platform_stats.sql:13-16`) are **STALE**.
- **Integer check:** int32 max is `2147483647`. `2000000000 + 200000000` wraps to `-2094967296`. Bonus is on before that add and off after. `2147483647 + 1` wraps to `-2147483648`. The tier can turn on (threshold is below the max) and then turn off on the next overflowing add. Go and TypeScript both read the stored value, so both drop the 15 bps together.
- **Existing evidence:** canonical report; plan Phase 4 (`BIGINT` / `int64`); FINDING-011 (`NOT TESTED`).
- **Smallest fix:** new migration `ALTER COLUMN ... TYPE BIGINT` (do not rewrite `0049` if it has already been applied). Go `int64`, and `SET total_processed_fils = total_processed_fils + $1`. Same comparison in `platformVolumeTier.ts`.
- **Dependencies:** The bonus is subtracted inside `CloseBatch` before `ComputeSettlementFee` (`batch.go:141`, `:208-212`) and inside capture (`capture.ts:168-196`). Overflow changes both fees. It does not by itself fix BUG-032’s formula split.

## BUG-032 — TypeScript and Go fees differ

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-032-ts-and-go-fee-formulas-diverge.md) matches HEAD. Its “Bug 11” payment-link pointer is the current **BUG-023**, not BUG-011.
- **Evidence:** Go `ComputeSettlementFee` discounts the amount, then applies MDR (`apps/settlement/internal/settlement/discounted_fee.go:7-9`), and `CloseBatch` sums that per event (`batch.go:212`). Capture charges full MDR and stores `metadata.feeFils` (`apps/api/src/payments/capture.ts:196`, `:222-229`). `applyCaptureDiscountAdjustment` then takes basis points of that fee (`apps/api/src/payments/discountAdjustment.ts:70-73`) and is called from the merchant capture route only (`apps/api/src/routes/transactions.ts:111`). Payment-link pay calls `captureTransaction` and does not call the adjustment (`apps/api/src/paymentLinks/pay.ts:114-125`). The MK comment on `:115` that the discount was moved into `capture.ts` is **STALE**.
- **Integer check:** half-to-even. Amount `2500` fils, MDR `250` bps, discount `250` bps: Go fee `61`, TypeScript net fee `60` (gross fee `62`, adjustment `2`). Amount `21`, MDR `250`, discount `333`: Go `0`, TypeScript `1`. In amounts `1..4999` and five discount rates at 250 bps, 5795 pairs differ. With discount 0 the two formulas match `ApplyRateFils`. A payment-link capture journals the full MDR and never posts the fee discount, so the ledger and `CloseBatch` differ by the whole discount, not by one rounding fil.
- **Existing evidence:** canonical report; plan Phase 4; FINDING-025 (`NOT TESTED`).
- **Smallest fix:** one function: MDR on `(amount − discount)`, integer fils, used by capture and `CloseBatch`. Put it inside `captureTransaction` so payment links take the same path, and do not also post `applyCaptureDiscountAdjustment` on that fee (that would discount twice).
- **Dependencies:** BUG-023 is the payment-link skip. BUG-031’s tier bonus is applied on both sides before this formula; keep that order when unifying. Display MDR (BUG-071) is a separate schedule lookup.

## BUG-033 — March sweep is not idempotent

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-033-march-sweep-not-idempotent.md) matches HEAD. Script was not executed.
- **Evidence:** `monthBounds` is `Date.UTC` (`scripts/reconcile_march.ts:16-18`). Residue is `capturedFils % 10` (`:28-29`), summed per merchant from `transactions.captured_fils` (`:38-49`, `:56-68`). `postResidueCorrection` uses `randomUUID()` and inserts with no `WHERE NOT EXISTS` (`:71-81`): debit `merchant_payable`, credit `scheme_rounding_residue`, `occurred_at` = run time. `ledger_entries.entry_group_id` is not unique (`db/migrations/0007_ledger_double_entry.sql:21-23`); the balance trigger accepts any new group whose own legs net to zero (`:43-70`). The comment on `:71` that re-running dedupes is **STALE**. No Go file references `scheme_rounding_residue`.
- **Integer check:** two 6-fil events sum to residue `12` under `% 10` per row, and to residue `2` under one scheme line `(6+6)%10`. `2026-03-01 02:00` Bahrain is `2026-02-28 23:00Z` (outside UTC March). `2026-04-01 01:00` Bahrain is `2026-03-31 22:00Z` (inside UTC March). ADR-0002’s amount is `gross_fils - truncated amount_fils` on `card_scheme_clearing` / `scheme_rounding_residue`, not this merchant debit. ADR-0003’s claim that the three-hour shift leaves monthly totals equivalent is **STALE** for this residue: the rows that move are not equal `% 10` amounts.
- **Existing evidence:** canonical report; plan Phase 4; FINDING-009 (`NOT TESTED`); `docs/adr/0002-scheme-residue-at-export.md`.
- **Smallest fix:** do not run this script. After BUG-034 posts the ADR legs on new closes, leave the script unused or make it refuse to run. A historical backfill, if still required for batches already frozen, needs a deterministic `entry_group_id`, `INSERT … WHERE NOT EXISTS`, Bahrain March bounds, residue = `gross - truncated` per scheme line, and the ADR accounts. A new random group will not collide with those legs, so it will not dedupe against them.
- **Dependencies:** see the BUG-033 / BUG-034 section. `CloseBatch` treats a non-open batch as a no-op (`batch.go:93-111`), so BUG-034 will not backfill March rows that are already closed.

## BUG-034 — Scheme amount rounds; residue is not posted

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-034-scheme-export-rounding-always-over.md) mechanism matches HEAD. The title and legacy name “always over” are **STALE** for lines whose third digit is 0–4: the file then matches truncated fils, and the defect is the unposted residue.
- **Evidence:** `TruncateToSchemeAmount` is `(gross/10)*10` (`scheme_export.go:23-25`). `SchemeAmountBD` is `float64(gross)/1000` (`:29-31`). `CloseBatch` inserts both (`batch.go:250-255`). `amount` is `NUMERIC(10,2)` (`db/migrations/0050_scheme_export_lines_acquirer_amount.sql:12-13`); `amount_fils` must be a multiple of 10 (`db/migrations/0008_scheme_export_lines.sql:12`). Export prints `sel.amount`, not the fils column (`scheme_export.go:71`). `formatFilsAsTwoDecimalString` (`:102-115`) is integer formatting and is not used by the insert. No `scheme_rounding_residue` post exists in `CloseBatch`. The 0050 comment that file and fils always agree (`:19-20`) is **STALE**. ADR-0002 status “implemented (CloseBatch, 2026-03)” and the same status in `docs/adr/README.md:9` are **STALE**. The implementation note that the March script exists because CloseBatch already posted residue (`0002-scheme-residue-at-export.md:35-39`) is **STALE**.
- **Integer check:** truncation residue is `gross % 10` (0–9). `4747 → 4740` (residue 7), `1005 → 1000` (residue 5), `12344 → 12340` (residue 4). Float64 printed at 15 and 16 significant digits is `4.747`, `1.005`, and `12.344`. Half-away-from-zero to two decimals is `4.75` (4750 fils, 10 above truncated), `1.01` (1010, 10 above), and `12.34` (12340, equal to truncated). `4747` and `1005` are the amounts in `scheme_export_test.go`; that test only checks a two-decimal regex (`scheme_export_test.go:12-45`), so a green test does not prove the fils.
- **Existing evidence:** canonical report; plan Phase 4; ADR-0002 decision table (the decision, not the status line); FINDING-003 and FINDING-004 (`NOT TESTED`).
- **Smallest fix:** persist `amount` from truncated fils (`truncated/1000` at two decimals, via the existing integer formatter). In `CloseBatch`, post `gross - truncated` when it is non-zero (ledger `CHECK (amount_fils > 0)`): credit `card_scheme_clearing`, debit `scheme_rounding_residue`, per ADR-0002. Skip a zero residue.
- **Dependencies:** section below. Export must keep reading the stored `amount`, so the insert has to change; formatting at read time would not fix rows already written.

## BUG-035 — MDR recalc rewrites paid batches

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-035-mdr-recalc-rewrites-paid-batches.md) matches HEAD.
- **Evidence:** select is `status <> 'open'` (`recalculate_mdr.go:63-69`), then `UPDATE settlement_batches SET fee_fils, net_payout_fils` (`:108-110`) and a cache delta (`:116`). The struct comment that paid figures stay as paid (`:19-21`) is **STALE**. `apps/api/src/routes/admin.ts:50-53` (“paid batches are never modified”) is **STALE**. The adjustment insert uses `uuid.New()` (`:188-194`), so a second recalc posts another balanced group; that is extra non-idempotence, not a substitute for the status bug.
- **Existing evidence:** canonical report; plan Phase 4; FINDING-020 (`NOT TESTED`).
- **Smallest fix:** `status = 'closed'` only. Do not `UPDATE` a `paid` row.
- **Dependencies:** new net is integer `gross - newFee` (`:103`), so this path also overwrites a BUG-010 float net whenever the fee changes. Fix the predicate even if BUG-010 lands first. Reopening paid history is out of scope.

## BUG-036 — Daemon uses the UTC calendar date

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-036-daily-close-runs-at-3am.md) date bug matches HEAD. The “~03:15” timing is **STALE** for the default 15-minute delay: yesterday becomes eligible at 03:00:00 Bahrain, not 03:15. The comment at `daemon.go:89` is the same stale observation. `window_utc_compat_test.go:15-37` locks the current UTC-date behavior; a green run is not a verifier.
- **Evidence:** `runIfDue` sets `now := time.Now().UTC()` and calls `BusinessDayWindow(now)` (`apps/settlement/internal/scheduler/daemon.go:80-90`). `BusinessDayWindow` reads `date.Date()` in the instant’s location, then places that Y/M/D at Asia/Bahrain midnight (`apps/settlement/internal/settlement/window.go:12-25`, `:42-48`). Default delay is 15 minutes (`apps/settlement/internal/config/config.go:86-87`); poll is 60 seconds (`:92-93`). The comment that UTC is fine (`daemon.go:78-79`) is **STALE**.
- **Integer / clock check:** Bahrain is UTC+3. At 2026-10-30 01:00 and 02:59 Bahrain the UTC date is 2026-10-29, `todayStart` is 2026-10-29 00:00 Bahrain, `dueAt` (00:15 that day) is already past, and the business date is 2026-10-28. At 2026-10-30 03:00:00 Bahrain the UTC date is 2026-10-30, `dueAt` is 00:15 Bahrain (already past), and the business date is 2026-10-29. A date-only `2026-03-24T00:00Z` still windows 2026-03-24 00:00–2026-03-25 00:00 Bahrain, which is the correct window for that calendar date. The defect is `time.Now()`, whose UTC Y/M/D is yesterday until 03:00 Bahrain.
- **Existing evidence:** canonical report; plan Phase 4; FINDING-024 (`NOT TESTED`). ADR-0003’s daily rule (use `BusinessDayWindow` as the Bahrain day) is the requirement. Its monthly-equivalence consequence is not a reason to keep this UTC `now`.
- **Smallest fix:** inside `BusinessDayWindow`, convert `date` to `businessDayLocation` before `Date()`. That makes `time.Now().UTC()` use the Bahrain calendar date and leaves a UTC-midnight `YYYY-MM-DD` on the same calendar date. The 23:59 UTC case in `TestBusinessDayWindow_IgnoresClockTime` encodes the bug and has to change. Daemon delay then means 15 minutes after Bahrain midnight.
- **Dependencies:** Until this lands, the daemon from 00:00–03:00 Bahrain targets the day before yesterday (usually already closed, so a no-op) and does not close yesterday. BUG-037 is the manual today/future freeze. Fix the window before relying on the daemon to choose a completed day.

## BUG-037 — Any calendar date freezes

- **Status:** High; verified, OPEN. [Canonical report](../bugs/bug-037-settlement-close-any-date-is-final.md) matches HEAD.
- **Evidence:** Admin `POST /settlement/run-batch` checks `^\d{4}-\d{2}-\d{2}$` and nothing about completion (`apps/api/src/routes/admin.ts:68`, `:109-123`). The internal handler only `time.Parse("2006-01-02")` (`apps/settlement/internal/internalapi/server.go:36-38`, `:217-237`). The CLI does the same (`apps/settlement/cmd/settlement/main.go:103-107`). `CloseBatch` inserts `open` (`batch.go:71-75`), and zero events still freeze the row (`:185-186`, `:229-234`). A later call seeing any status other than `open` returns the frozen totals (`:93-111`). `ADMIN.md:73-75` (“already closed or paid are skipped, so re-running is always safe”) describes that no-op and is **STALE** as a claim that picking today or a future date is safe. `ADMIN.md:16-18` (“None of it can break the books”) is **STALE** for this action and for BUG-011 / BUG-035.
- **Existing evidence:** canonical report; plan Phase 6 (refuse close of today/future). No runtime artifact.
- **Smallest fix:** before insert, reject a business date whose Bahrain window has not ended (`end > now` in `businessDayLocation`). One check in `CloseBatch` covers admin, internal HTTP, CLI, and the daemon.
- **Dependencies:** BUG-036 chooses the daemon’s date. This guard does not reopen a batch already frozen early. Go’s parse already rejects impossible dates such as `2026-02-31`; the hole is a real today or future date.

## BUG-063 — Lifetime payout estimate is float32

- **Status:** Medium; verified, OPEN. [Canonical report](../bugs/bug-063-lifetime-payout-estimate-float32.md) matches the writer and the column. No API or web reader of the column was found, and `EstimateMonthlyPayout` has no callers, so “finance quotes the dashboard” is **unverified**. The stored-value defect stands.
- **Evidence:** column is `REAL` (`db/migrations/0040_merchants_lifetime_payout_monitoring_estimate.sql:6-7`). `PayoutBatch` adds `float32(netPayoutFils)` in SQL (`payout_estimate.go:14-19`, called from `batch.go:352`). `EstimateMonthlyPayout` sums `float32` in Go (`payout_estimate.go:28-52`) and is unused. `PayoutSplitBatch` does not update the column. The 0040 comment that nothing reads it back matches this pass for application code; the settlement test reads it (`payout_estimate_test.go:31-39`) with totals that are still exact in float32.
- **Integer check:** IEEE float32 at `16777216 + 1` stays `16777216`. The next ulp is 2. `2^24` fils is `16777.216` BD of accumulated net, not of one batch.
- **Existing evidence:** canonical report; plan Phase 4 groups it with BUG-031 (`BIGINT` / `int64`). No runtime finding.
- **Smallest fix:** new migration to `BIGINT`, add `net_payout_fils` as an integer. Do not rewrite `0040` in place if it has been applied. Leave the unused float monthly helper summing `int64` or delete it in the same change; do not keep a second float accumulator.
- **Dependencies:** The addend is BUG-010’s net. Split payouts currently skip the column; do not treat the column as a lifetime sum of split parents until that call exists. Not a payout leg.

## BUG-064 — Daily loop returns on the first merchant error

- **Status:** Medium; verified, OPEN. [Canonical report](../bugs/bug-064-daily-batch-stops-on-first-merchant.md) matches HEAD. Phase 7, not a Dilmune blocker. The “failing merchant is first” sentence means first remaining error: earlier merchants that already closed and paid are no-ops and the loop still returns before the tail.
- **Evidence:** merchants are sorted by id string (`batch.go:408`, `:427`). `ErrMerchantNotEligible` continues (`:432-437`). Any other `CloseBatch` error returns immediately (`:439`). `IsSplitParent`, `PayoutSplitBatch`, and `PayoutBatch` errors also return (`:446-461`). The daemon logs that error and waits for the next tick (`daemon.go:92-95`), default 60 seconds (`config.go:92-93`).
- **Existing evidence:** canonical report; plan Phase 7. No runtime artifact.
- **Smallest fix:** record the merchant id and error, continue the loop, and log or alert the failed id. Do not `return` out of `RunDailyBatch` for one merchant.
- **Dependencies:** A continued loop still hits BUG-036’s date and BUG-037’s freeze. Continuing does not make a bad date safe. Idempotent no-ops on already paid merchants are why the same failure blocks the tail on every later tick.

## BUG-033 and BUG-034

ADR-0002 option A is the rule that still matches `packages/money`: at export, each line’s scheme `amount` is truncated fils at two decimals, and `gross_fils - amount_fils` is journaled as credit `card_scheme_clearing` / debit `scheme_rounding_residue`. The status line says that landed in `CloseBatch` in March 2026. It did not. The only writer of `scheme_rounding_residue` in executable code is `scripts/reconcile_march.ts`, and its legs are debit `merchant_payable` / credit `scheme_rounding_residue` for `sum(captured_fils % 10)` over a UTC month, dated `now()`, with a new UUID every run.

Those are not two implementations of one residue. Per-transaction `% 10` is not line truncation (`6+6` is 12 versus 2). The UTC window is not the Bahrain business month. The merchant-payable debit is not the scheme-clearing credit. A second run adds another balanced group because nothing dedupes it.

`CloseBatch` will not repair closed March batches after BUG-034: status other than `open` returns the frozen row. BUG-034 stops new gaps. It does not justify running the current script “once more” for history. Running it after BUG-034 posts a second, different charge against `merchant_payable` for any March activity the script still selects, including days BUG-034 will also residue-post if they are still `open`.

Order: BUG-034 first, for new closes only. Do not execute `reconcile_march.ts`. If finance still needs a March backfill, that backfill has to use the ADR amount and accounts, Bahrain bounds, and a deterministic `entry_group_id` with `WHERE NOT EXISTS`, and it has to be written so it cannot fire on a batch BUG-034 has already posted. “Document do not run” is the smallest change that matches the code. Idempotency cosmetics on the current formula would preserve the wrong residue.

## Webhook payout handoff

`PayoutBatch` already posts the ledger payout: debit `merchant_payable`, credit `platform_cash`, amount `net_payout_fils`, then sets `paid` (`batch.go:330-358`). It does not insert `settlement_payout_disbursements`. `PayoutSplitBatch` posts one group per positive child share and debits the cache by `totalAllocated` (`allocate.go:107-142`). Neither function enqueues the merchant webhook.

`EnqueuePayoutNotifications` runs after those transactions (`daemon.go:107`, `main.go` run-batch). It selects `status = 'paid'` and `net_payout_fils > 0`, and inserts `settlement.paid` with the batch net (`payout_notify.go:13-21`, `:32-39`, `:77-88`). Split batches are included on purpose, using the parent and the full batch net, not the posted shares. `settlement.batch_closed` is not in `WEBHOOK_ELIGIBLE_EVENT_TYPES` (`apps/api/src/webhooks/dispatcher.ts:27-32`).

The bank-facing row is a delivery side effect. On `attempt_count === 0`, `PRE_DELIVERY_EFFECTS["settlement.paid"]` calls `recordPayoutDisbursementEffect` (`dispatcher.ts:37-41`, `:160-163`), which inserts `amount_fils` and a new `disb_` reference with no unique batch key (`apps/api/src/webhooks/payoutDisbursement.ts:4-18`). The delivery payload is the envelope, so `data.settlementBatchId` and `data.netPayoutFils` come from the outbox (`apps/api/src/webhooks/envelope.ts:69-79`). This is BUG-050, already runtime-reproduced: `Evidence/runtime-artifacts/probes1-console-2.txt` EVID-022 / P012, one batch net 975 fils, two endpoints → two rows, one replay → three rows totaling 2925. Not re-run here.

Consequences for this cluster:

- The disbursement amount is BUG-010’s `net_payout_fils`, copied through the outbox. Fixing payable arithmetic changes later disbursement rows only when they read that column. It does not collapse duplicate rows.
- For a split parent, the ledger moves `totalAllocated` (BUG-030) and the disbursement records the batch net. Those fils match only when the shares sum to the net.
- BUG-034’s residue is not on this path. `CloseBatch` enqueues `settlement.batch_closed`, and the dispatcher does not deliver that type or post residue from it.
- Smallest BUG-050 fix stays outside these twelve: record the disbursement in the payout function that posts the ledger, remove `PRE_DELIVERY_EFFECTS`, and unique `settlement_batch_id`. The recorded fils should be the same integer the ledger debit uses after BUG-010 and BUG-030. Do not implement that inside the float32 one-line change.

## Stale documents (do not treat as the rule)

| Document | Claim | Why it is stale |
|---|---|---|
| `docs/adr/0002-scheme-residue-at-export.md:3`, `:35-39`; `docs/adr/README.md:9` | Residue posting implemented in `CloseBatch`, March 2026; March script only covers the pre-deploy gap | No Go posting. The script uses other accounts, `% 10`, UTC, and a new UUID |
| `docs/adr/0003-report-date-windows.md:26-29`, `:37` | Three-hour UTC month shift nets to the same monthly total; finance accepted it | Residue `% 10` is not preserved by swapping boundary transactions. Not a reason to keep the sweep or the UTC `now` |
| `docs/adr/0004-balance-rebuild-source.md:20-28` | Button rebuild is settled activity and agrees with the ledger path | View is lifetime truncated scheme gross, all batch statuses |
| `docs/ADMIN.md:16-18`, `:73-81` | Admin actions cannot break the books; re-run and rebuild are always safe | Today/future close freezes the day; rebuild overwrites the cache from scheme gross; MDR recalc updates paid rows |
| `apps/api/src/routes/admin.ts:50-53`; `recalculate_mdr.go:19-21` | Paid batches are not modified | `status <> 'open'` then `UPDATE` fee and net |
| `db/migrations/0050_scheme_export_lines_acquirer_amount.sql:19-20` | File amount equals truncated fils | Insert passes `float64(gross)/1000` into `NUMERIC(10,2)` |
| `scripts/reconcile_march.ts:71` | Re-run is safe because `entry_group_id` dedupes | New UUID; no existence check; group id is not unique |
| `apps/api/src/paymentLinks/pay.ts:115` | Discount moved into `capture.ts` | Capture applies MDR only; pay does not call the adjustment |
| `apps/api/src/fees/platformVolumeTier.ts:6-7`; `0049_platform_stats.sql:13-16` | Counter is BIGINT / 64-bit and cannot overflow | Column is PostgreSQL `INTEGER`; Go adds `int32` |
| `allocate.go:31-32` | Split shares sum to net | Half-to-even per child does not |
| `daemon.go:78-79`, `:89` | UTC `now` is fine; close lands ~03:15 | Bahrain date is wrong until 03:00; default delay does not move eligibility to 03:15 |

ADR-0001 and the ADR-0002 decision table (not its status line) are the requirements used above.
