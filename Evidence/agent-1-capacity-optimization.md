# Checkout capacity: source review and pending benchmark

Date: 2026-10-30 (Asia/Bahrain). Baseline HEAD:
`1f88a47ee619e87728219ad531df4dc4e4cbad56`.

**No capacity improvement has been measured or implemented.** The user clarified
that Docker is unavailable and requested benchmark preparation and source review,
without relying on the existing localhost database. The runtime comparison remains
pending. New tooling does not change application behavior, schemas, dependencies,
the protected money package, or the partner contract.

## Baseline identity and environment

Windows PowerShell; Node 22.19.0, npm 10.9.3, Go 1.24.2. Docker is not on PATH or
at its usual Docker Desktop executable path. WSL enumeration initially returned
access denied; an elevated inventory attempt returned exit 1 with no usable
runtime. No approval-review rejection occurred. PostgreSQL 18 binaries appear
installed, but native execution would not establish the requested Linux/container
resource equivalence, so no native database was created or used.

`DATABASE_URL` and `ops/.env.docker` were absent. TCP listeners existed on 5432 and
3000. Two read-only HTTP probes returned `/healthz` 200 and `/readyz` 200. Those
responses do not establish source identity, database identity, or current DB
reachability. No SQL query, payment, fixture insert or load was sent to that API
or database. Listener-process inventory produced no usable ownership information.

The deployment documents record release `20261030-1f88a47` at the public preview
and an inactive API pending production configuration. These are recorded claims,
not a deployment reinspection. No SSH, deployment, public load test or submitted
server modification was performed; the submission change window was not checked
because no server change was attempted. Deployed image IDs and enforced limits
remain unverified.

Pre-existing dirty paths were `.api-run.log`, `context/{CHANGELOG,INFRASTRUCTURE,
KNOWN_ISSUES,TESTING}.md`, `context/modules/scripts-and-ops.md`, and `ops/README.md`.
Pre-existing untracked material included the production Dockerfile/Compose/nginx
and runbook, deployment report, slide brief, slides and presentation. These were
preserved. Context additions below append findings to existing work; no deployment
file was edited. No commit, push, branch switch or merge was performed.

## What source establishes

| Item | Evidence | Status in this workstream |
|---|---|---|
| Historical acquirer waits retain a DB connection | Current `authorize.ts` awaits committed preparation before calling authorize; current `capture.ts` calls prepare, acquirer, then apply. `withTransaction.ts` releases in finally. | `already-fixed` (source; runtime reconfirmation pending), BUG-061/historical authorization counterpart |
| Failed capture reopens a link with a live hold | `paymentLinks/pay.ts` voids a definitive 402 before releasing; ambiguous 5xx/throws retain the key/request reservation. | `already-fixed` (source; integration reconfirmation pending) |
| Checkout-specific bounded admission | `routes/paymentLinks.ts` directly invokes the domain function; no checkout semaphore/rate/queue bound in registration or app setup. pg acquisition timeout defaults to 5000 ms, but does not bound HTTP request count. | `confirmed-current`, P2 overload-control gap; load impact not measured |
| Deployment resource enforcement | Neither existing local nor new production Compose declares CPU/memory limits. Pool comments describe a budget but cannot enforce it. | `confirmed-current`, P2 deployment-budget gap; live limits unknown |
| Next performance bottleneck | Reporting locks all of `outbox_events` in SHARE mode throughout a batch (default 500 events), conflicting with payment event INSERTs; short checkout transactions still perform many SQL round trips. | `unverified` performance hypothesis; do not remove correctness barrier |
| Long-run simulator memory | Three operation-result Maps persist until process restart. They retain results across successful unique operations. | `unverified` capacity impact; deleting entries would change retry behavior |

Scoped counts: `historical-report` 0, `confirmed-current` 2, `already-fixed` 2,
`duplicate` 0, `stale-or-invalid` 0, `unverified` 2, `fix-verified` 0. These are six
workstream findings, not a reclassification of all 86 registry bugs. There are two
confirmed P2 gaps; no financial defect was changed here.

Capture prepares and applies under the claim -> transaction lock order; apply
also locks the durable claim before financial writes. Capture/refund headroom,
ledger, idempotency and outbox correctness must be proven with real database tests
before any optimization. No row lock, durable write, claim or event was removed.
The unused `recordCaptureMetric` helper is not evidence of a second live write;
the capture path publishes the outbox event and reporting updates the projection.

Pool budget from source: API 5 + reporting 5 + settlement 5, plus API and reporting
dedicated LISTEN clients = approximately 17 persistent connections at defaults.
Allow headroom for probes, migration/test tooling and operations. The prepared
isolated DB permits 40 connections. This is budgeting, not a measured optimum;
PG_POOL_MAX is unchanged. Reporting cursor/apply changes commit atomically, so
older context statements claiming otherwise are stale for this source revision.

Webhook HTTP transport is outside its DB transaction; due deliveries use leases,
retry/backoff and a dedicated notification listener. Reporting uses cursor locking
and atomic apply/watermark writes. These mechanisms support recovery in source,
but restart survival/catch-up and financial recovery were not exercised here.
Simulator idempotency caches are process-local, so durable provider outcome replay
across API restart cannot be inferred from the caches.

ADR 0003/0004/0006 balance/time-window conflicts remain open human decisions;
Proposed ADR 0005 remains paused. No new financial interpretation was introduced.

## Prepared artifacts

- `scripts/checkout-capacity.mjs`: Node 22 HTTP client, closed-loop or fixed-arrival
  stages, fresh pre-created link per checkout, GET then pay, 1000 fils, synthetic
  card, unique key, no automatic retries. Refuses non-127.0.0.1 URLs, credentials,
  path prefixes and redirects. An explicit isolated-simulator attestation is
  required; it is not proof that a loopback proxy is safe. Operator must verify
  the target image and topology first.
- `scripts/checkout-capacity.test.mjs`: real loopback HTTP fixtures test result
  classification, refusal of unsafe inputs, arrival generator drops and closed
  fixture exhaustion. These are runner tests, not payment-system benchmarks.
- `scripts/checkout-capacity-prepare.mjs`: additive merchant/link fixtures, only at
  host `capacity-postgres`, database `filspay_test_capacity`. No seed/truncate.
  A fresh merchant identifies each stage for read-only accounting. Manifests are
  exclusive-create files; a write failure after DB commit leaves fixtures intact
  and requires a new label. No cleanup is attempted.
- `ops/capacity/{compose.yml,nginx.conf,init.mjs,run-stage.ps1,checks.sql,.gitignore}`:
  separate DB volume, fixed simulator settings, generated private configuration,
  stage commands and read-only accounting. No existing Compose overlay is used.

Docker build/Compose semantic validation and fixture SQL execution are **pending**.
Node syntax checks and PowerShell parsing passed. No claim is made that the new
stack has booted. Existing build inputs include native Node dependencies and
require network access during image builds. Image tags are mutable until their
IDs/digests and source hashes are recorded for each arm.

## Exact future setup commands (PowerShell, repository root)

Use a disposable Linux Docker host/VM with 1 vCPU and 2 GiB for the strongest
whole-host claim. On a larger Docker Desktop host these per-container quotas
simulate service limits, not total host/OS equivalence. The load generator should
run outside the judged host through a loopback SSH tunnel if needed; do not spend
the service budget on client-side traffic generation.

```powershell
node ops/capacity/init.mjs
$env:CAPACITY_IMAGE_TAG = 'baseline'
$capacityCompose = @('compose', '--env-file', 'ops/capacity/.env', '-p', 'filspay-capacity-baseline', '-f', 'ops/capacity/compose.yml')
docker @capacityCompose config --quiet
docker @capacityCompose build migrate
docker @capacityCompose build settlement
docker @capacityCompose up -d nginx reporting settlement
docker @capacityCompose ps -a
docker @capacityCompose exec -T capacity-postgres psql -U capacity -d filspay_test_capacity -c 'SELECT current_database(), version(), 1 AS real_query;'
node -e "for(const p of ['/healthz','/readyz']) {const r=await fetch('http://127.0.0.1:3300'+p); console.log(p,r.status,await r.text()); if(!r.ok)process.exitCode=1;}"
docker @capacityCompose images --format json
docker @capacityCompose exec -T api sha256sum apps/api/src/payments/authorize.ts apps/api/src/payments/capture.ts apps/api/src/paymentLinks/pay.ts
git rev-parse HEAD
git status --short
```

`init.mjs` must run only once: exclusive creation refuses to rotate an existing
private configuration. Never print `.env` or unrestricted `docker inspect/config`
output. `.env` and runtime manifests/results are ignored. No public database port
is published. The development/test simulator is intentional; production OTP
configuration is not weakened or changed. No auth middleware is removed; direct
fixture inserts prepare data outside the measured journey, which begins at the
deliberately public hosted-checkout endpoint. Login is a separate journey.

Expected steady limits (must verify with inspect, not trust this table):

| Service | CPU quota | RAM / RAM+swap maximum |
|---|---:|---:|
| API | 0.50 | 512 / 512 MiB |
| Postgres | 0.25 | 640 / 640 MiB |
| Reporting | 0.075 | 192 / 192 MiB |
| Settlement | 0.075 | 192 / 192 MiB |
| nginx | 0.05 | 64 / 64 MiB |
| Sum | 0.95 | 1600 MiB |
| Remaining whole-host allowance | 0.05 | 448 MiB |

The remaining allowance includes OS, Docker daemon and low-frequency monitoring.
Its adequacy is unmeasured. Migration/prepare/build containers are outside timing;
do not run them during a measurement. Swap disablement and cgroup support must be
verified on the actual host. Images have no automatic restart so failures remain
visible; restart counts still need recording.

```powershell
$capacityIds = docker @capacityCompose ps -q api capacity-postgres reporting settlement nginx
foreach ($capacityId in $capacityIds) {
  docker inspect --format '{{.Name}} image={{.Image}} cpus={{.HostConfig.NanoCpus}} memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}} restarts={{.RestartCount}} oom={{.State.OOMKilled}}' $capacityId
}
```

## Scenario, stages and comparisons

Acquirer settings: min/max 100/400 ms, failure rate 0.02 per call, RNG seed 42.
Seeded order can change with concurrency; do not expect identical failures across
different schedules. Preserve settings and resource limits between arms. One new
single-use 1000-fils link per iteration; GET -> pay; no think time. Preparation is
outside timing. Fresh fixture merchant per stage prevents mixing accounting.

Run three repetitions. Each level gets a separate 60-second warm-up and
180-second measured stage, then a 60-second four-user recovery stage. Warm-up
and recovery need different fixture manifests, so consumed links are never reused.
Suggested closed users: 1, 2, 4, 8, 12, 20, 36, 80. Suggested offered checkout
arrival rates: 5, 10, 20, 40, 80 per second. Start low and inspect results before
overload. Stop on financial anomalies, restart/OOM or runaway backlog. Extend
the highest passing stage to 15 minutes in a separately provisioned run before
claiming sustained capacity; split/revise fixture limit for that longer run.

Single-stage commands (the result and fixture metadata paths are printed/saved):

```powershell
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label b-r1-warm-u8 -Mode closed -Load 8 -Seconds 60
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label b-r1-u8 -Mode closed -Load 8 -Seconds 180
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label b-r1-recovery-u8 -Mode closed -Load 4 -Seconds 60
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label b-r1-warm-rate20 -Mode arrival -Load 20 -Seconds 60
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label b-r1-rate20 -Mode arrival -Load 20 -Seconds 180
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label b-r1-recovery-rate20 -Mode closed -Load 4 -Seconds 60
```

Repeat with each load and labels r2/r3. Do not run stages concurrently. Client
max-in-flight is 1024; dropped arrivals or exhausted fixtures invalidate a capacity
assessment rather than silently reducing offered load. Arrival e2e includes
scheduler lateness, which is also reported separately. Completed throughput and
paid goodput divide by total elapsed including drain, avoiding boundary inflation;
offered/started rates divide by scheduled stage duration. Percentiles include
all started checkouts, including client failures; inspect paid-only distributions
separately if later added. Server admission cannot reliably be inferred from HTTP,
so the client emits null for admitted rate. Timeouts may leave payments executing:
drain/check the server before proceeding and keep fixture records for recovery.

To execute the complete baseline matrix after reviewing the first low-load run:

```powershell
foreach ($rep in 1..3) {
  foreach ($users in @(1,2,4,8,12,20,36,80)) {
    $label = "b-r$rep-u$users"
    & ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label "$label-warm" -Mode closed -Load $users -Seconds 60
    & ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label $label -Mode closed -Load $users -Seconds 180
    & ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label "$label-recovery" -Mode closed -Load 4 -Seconds 60
    # Inspect JSON, accounting/backlog and resource snapshots before continuing.
  }
  foreach ($rate in @(5,10,20,40,80)) {
    $label = "b-r$rep-rate$rate"
    & ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label "$label-warm" -Mode arrival -Load $rate -Seconds 60
    & ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label $label -Mode arrival -Load $rate -Seconds 180
    & ./ops/capacity/run-stage.ps1 -Project filspay-capacity-baseline -Label "$label-recovery" -Mode closed -Load 4 -Seconds 60
  }
}
```

The entire matrix takes at least 3.25 hours plus preparation/drain and review.
For interactive stop-on-anomaly review, run single stages instead of this loop.

For an optimized arm, first preserve the baseline IDs/results, then stop it
without deleting volumes, set a different image tag/project, build the candidate
and repeat precisely the same stages. Use a fresh project volume and the same
preparation schedule for each arm. Example:

```powershell
docker @capacityCompose down
$env:CAPACITY_IMAGE_TAG = 'candidate'
$capacityCompose = @('compose', '--env-file', 'ops/capacity/.env', '-p', 'filspay-capacity-candidate', '-f', 'ops/capacity/compose.yml')
docker @capacityCompose config --quiet
docker @capacityCompose build migrate
docker @capacityCompose build settlement
docker @capacityCompose up -d nginx reporting settlement
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-candidate -Label c-r1-warm-u8 -Mode closed -Load 8 -Seconds 60
& ./ops/capacity/run-stage.ps1 -Project filspay-capacity-candidate -Label c-r1-u8 -Mode closed -Load 8 -Seconds 180
```

Alternate arm order on later repetitions if possible. Old fixture growth, cache
warmth and run order must be recorded. No candidate is proposed yet. This
workstream's rollback is to stop the dedicated Compose project with `down`, retain
its evidence/volume, and stop using the new tooling; application rollback is not
needed. Do not delete volumes or reset shared databases.

## Thresholds and required telemetry

Historical report's chosen assessment bar: e2e p95 <= 1500 ms and unexpected
failures <= 1%; this is not an established business SLA. Count only recognized
402 decline bodies and 502 `acquirer_unavailable` as expected simulator outcomes.
Other 502s are unexpected. Record 429/503 as explicit rejections. The runner's
conservative threshold also counts rejections against the 1% failure budget, so a
fast all-rejected run cannot qualify as useful capacity. Generator invalidity
always fails assessment. Financial invariant failures invalidate every latency
claim. A controlled-overload experiment can be successful at shedding load while
still failing the capacity bar; report it separately.

Already emitted by client: offered/started/completed/paid rates, counts, p50/p95/
p99 including schedule lag, status histogram, expected declines/errors, overload
rejections, timeouts/network errors, drops, peak in-flight and retries (zero).
Transport errors/timeouts are incomplete from the client's view, even if the
server later commits. No reliable server-admitted count or retry-recovery result
is claimed.

Collect in another terminal, outside the judged host if practical:

```powershell
1..360 | ForEach-Object {
  Get-Date -Format o
  docker stats --no-stream --format '{{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}} pids={{.PIDs}}' $capacityIds
  Start-Sleep -Seconds 1
} | Set-Content ops/capacity/runtime/resource-samples.txt
docker @capacityCompose exec -T api sh -c 'cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.swap.current'
docker @capacityCompose exec -T capacity-postgres sh -c 'cat /sys/fs/cgroup/cpu.stat /sys/fs/cgroup/memory.events /sys/fs/cgroup/memory.swap.current'
```

Take cgroup/inspect snapshots both before and after; use throttling/OOM/restart
deltas. Recompute IDs after switching projects. Docker stats sampling itself adds
host overhead; monitor OS CPU/RAM/swap too and include it in whole-host totals.
On cgroup v1 replace paths after inspecting the host. These commands are prepared,
not executed here.

Read-only accounting example after b-r1-u8:

```powershell
$capacityMetadata = Get-Content ops/capacity/runtime/b-r1-u8-fixture-metadata.txt -Raw | ConvertFrom-Json
Get-Content ops/capacity/checks.sql -Raw | docker @capacityCompose exec -T capacity-postgres psql -v ON_ERROR_STOP=1 -v "merchant_id=$($capacityMetadata.merchantId)" -U capacity -d filspay_test_capacity
```

Run again after drain: paid links must resolve to one correct captured transaction;
duplicate references/capture events and unbalanced groups must be zero; captured
totals must match reporting after catch-up. Inspect holds and unresolved reserved
links without repairing/deleting them. SQL provides aggregates, not exhaustive
proof: replay/same-key and competing-key contention, refund/capture headroom,
cross-process crashes, settlement duplication and reopened-link recovery need
dedicated integration scenarios. Never interpret a zero webhook backlog as
delivery success when no endpoints were provisioned.

**Telemetry still requiring implementation/instrumentation:** server admission,
pool occupancy/waiter series and acquisition histogram, Node event-loop delay,
transaction-duration distribution, repeated lock snapshots/query plans, reporting
lag series, local webhook receiver and endpoint delivery/retry tests. The prepared
stack does not register webhook endpoints, exercise merchant/admin login, issue
refunds, force settlement, or automate crash/retry scenarios. Do not advertise it
as the complete correctness/monitoring campaign. Existing DB-backed tests must
run on a separate disposable test DB before the benchmark, so test truncations
cannot contaminate measured fixtures. No security allow-list is weakened to make
local webhook delivery work.

## Results, validation and limitations

| Measurement | Historical old image | Fresh current baseline | Optimized |
|---|---:|---|---|
| Closed-loop users inside historical bar | 8 | pending | no candidate |
| At 8 users: throughput | 9.2 checkout/s | pending | pending |
| At 8 users: e2e p95 | 1063 ms | pending | pending |
| At 80 users: e2e p95 | 8743 ms | pending | pending |
| Paid goodput, p99, sustained recovery/resource series | not established by new work | pending | pending |

Historical values come from `Evidence/capacity_checkout_load_test.md`, short
eight-second stages against an older image. They are not a current capacity
estimate. No new estimate is supplied. No current-bottleneck ranking by measured
impact, improvement claim, performance charts or optimized before/after deltas
are supportable yet. No optimization experiments were attempted without a valid
baseline; the only failed experiments were environment/tool availability checks.

Commands actually executed:

| Command/check | Actual result |
|---|---|
| git status / rev-parse; tool versions; config presence checks | identities above; existing work preserved; no secret values printed |
| docker version / executable lookup | Docker unavailable |
| WSL inventory | access denied, then no usable elevated inventory |
| TCP reachability, two HTTP health probes | listeners reachable, both HTTP 200; no DB query or source identity proof |
| `npm.cmd run typecheck` | passed all workspaces, db and scripts |
| `node --import tsx --test` with paymentLinks pay/status/serialize, db/pool and acquirer/simulator tests | 20 passed, zero failures/skips |
| `node --test scripts/checkout-capacity.test.mjs` | 4 passed, zero failures/skips; fixture HTTP only |
| `node --check` for runner, preparer and init | passed |
| PowerShell AST parse of run-stage.ps1; tracked diff whitespace check | passed |
| YAML parser attempt through Python | Python executable unavailable; Compose/YAML validation pending |
| `go test ./...` in settlement | initial default-cache ACL failure; retry with temporary GOCACHE passed available tests, DB-backed scenarios skipped without DATABASE_URL |

One first runner test invocation used the settlement working directory and failed
to locate the file; corrected repository-root invocation passed. Full API and
reporting workspace DB tests were **not run**, because no identified disposable
DATABASE_URL was configured. Go green output does not establish DB coverage.
No runtime benchmark, Docker image build, resource-limit enforcement, fixture SQL,
accounting query, OTP/tenant journey, real provider/payment, webhook delivery,
backlog catch-up or crash recovery was verified by this workstream.

Files added: the two runner files, fixture preparer, six ops/capacity files
including its ignore file, and this report. `.dockerignore` additionally excludes
capacity runtime artifacts from image builds. Context reviewed: payment flows, dependency
map, infrastructure, API/reporting modules, testing, known issues and changelog;
capacity findings are appended and the stale API lock claim is corrected. No
module dependency, architecture decision, financial behavior or route changed.

## Slide 6 and appendix

Suggested slide text: “The old image plateaued around 9 checkouts/s because it
held five DB connections during simulated provider waits. Current source releases
those connections before provider calls. A separate capped benchmark is prepared;
current sustained capacity and improvement remain unmeasured.”

Appendix chart plan once results exist: offered arrival rate vs paid goodput;
concurrency vs p50/p95/p99 with 1500-ms reference line; rejection/timeout/decline
rates; CPU/throttling/RSS and DB waiters over time; backlog rise/drain and recovery
latency. Separate historical old-image points from new arms. Do not populate new
charts from historical values or from runner HTTP-fixture tests.
