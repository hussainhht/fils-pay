# Capacity: fixed hosted-checkout load test

## Latest execution attempt — 30 October 2026

Current HEAD: `616d29be71202b88fac03e44ed9e04213caa4f7b`.
**Current-build capacity remains unmeasured.** `docker compose version` failed
because Docker is unavailable in this environment; the standard Docker Desktop
executable and private capacity configuration are also absent. The isolated
capped stack could not be started. No checkout load or SQL was sent to the
existing localhost service/database, and no public service was tested.

`node --test scripts/checkout-capacity.test.mjs` ran successfully: **4 passed,
0 failed, 0 skipped**, approximately 2.46 seconds. These exercise the load runner
against HTTP fixtures; they do not measure FilsPay throughput or financial
correctness. No new latency, goodput, capacity or improvement number is available.

The **8 users / approximately 9 checkouts per second below apply only to the
historical serving image**, not the current build. Current source already moves
authorize/capture provider waits outside database transactions; its effect still
requires a fresh runtime measurement.

The isolated stack, exact startup/stage commands, resource limits, repeat matrix,
metrics and pending checks are documented in
[the capacity preparation report](agent-1-capacity-optimization.md).
Application code was unchanged in this retry; typecheck and DB integration suites
were not rerun for this documentation-only update.

## Historical measurement

Measured 30 October 2026 against the process already listening on `127.0.0.1:3000` (`filspay-preview-api-1`). No application files were edited. Resource caps were applied only for the run, then the containers were recreated from `ops/docker-compose.yml` with `--no-build`, which restored the original unlimited settings. `/healthz` returned 200 after that recreate.

## Estimate

**8 concurrent simulated users.**

That is the highest closed-loop concurrency at which this checkout stayed inside the bar below. Throughput stops rising there, at about **9 checkouts per second**. More users do not get more payments through; they wait.

The bar used here, because the brief says “fast and correct” without a number:

- Fast: end-to-end p95 of `GET /v1/payment-links/:token` plus `POST /v1/payment-links/:token/pay` ≤ 1500 ms.
- Correct: unexpected failures ≤ 1%. A 402 decline or a 502 `acquirer_unavailable` is the simulator’s default 2% failure rate, counted separately, not as a capacity error.

One user already sits at about 750 ms p95, because each checkout sleeps twice inside the acquirer simulator (uniform 100–400 ms, mean about 250 ms each). 1500 ms is twice that floor.

## What one simulated user did

Fixed scenario, one fresh payment link per iteration:

1. `GET /v1/payment-links/:token`
2. `POST /v1/payment-links/:token/pay` with `Idempotency-Key`, amount **1000 fils** (1.000 BD), test PAN `4111111111114242` (not a magic decline).

Links were created beforehand as Alpha Retail (`9972daab-2c86-459f-9d78-3fe1be4e3280`, `owner@alpharetail.example`) so link creation is not inside the measured user loop. Each level ran for about 8 seconds, closed loop: a finished user immediately starts another checkout.

k6 is not installed. The runner was a Node.js 22.23.2 `fetch` script (client timeout 12 s on the ramp, 15 s on the overload). Same shape as a k6 constant-VU scenario.

## Caps used for the measurement

`ops/docker-compose.yml` sets neither CPU nor memory, and `restart` is `no`. For the run only, `docker update` set:

| Container | CPU | Memory |
|---|---|---|
| api | 0.50 | 512 MiB |
| postgres | 0.30 | 768 MiB |
| settlement | 0.10 | 256 MiB |
| reporting | 0.10 | 256 MiB |

That is 1.00 vCPU and 1792 MiB for the whole stack, with the API at the judged 0.5 vCPU / 512 MiB. Docker Desktop itself had 8 CPUs and about 7.6 GiB; the caps are what made the box match the brief. Acquirer latency and failure rate were the process defaults (100–400 ms, 2%), because those env vars are unset.

## Results

| Users | Checkouts | Paid | Simulator 402/502 | Capacity errors | e2e p50 | e2e p95 | Checkouts/s | Inside the bar |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 14 | 13 | 1 | 0 | 577 ms | 751 ms | 1.7 | yes |
| 2 | 31 | 30 | 1 | 0 | 557 ms | 737 ms | 3.8 | yes |
| 4 | 62 | 59 | 3 | 0 | 542 ms | 742 ms | 7.3 | yes |
| 8 | 79 | 74 | 5 | 0 | 850 ms | 1063 ms | 9.2 | yes |
| 12 | 77 | 72 | 5 | 0 | 1238 ms | 1868 ms | 8.7 | no, too slow |
| 20 | 125 | 123 | 2 | 0 | 2000 ms | 2708 ms | 9.3 | no |
| 36 | 104 | 98 | 6 | 0 | 3606 ms | 4400 ms | 9.3 | no |
| 80 | 155 | 151 | 4 | 0 | 8550 ms | 8743 ms | 8.9 | no |

12 users is the first step that misses the latency bar. From 8 users upward the rate stays on a plateau of about 9 checkouts/s, so the extra concurrency is queueing. At 80 users every response was still a normal paid, decline, or acquirer error. None were HTTP 500, and none hit the client timeout.

After the 36-user wave, 4 users on the same process: 53/53 paid, p95 **686 ms**, `/healthz` uptime still climbing (about 13690 s → 13771 s). After the 80-user wave the pre-created links were used up, so that script’s recovery step had nothing to pay. A follow-up of 16 checkouts on the same process all returned 200. The process was not replaced until the caps were removed after the test.

## Where the time goes

The limiter is the API’s Postgres pool of **5** connections, held open across the acquirer sleep.

The image that was serving (it is not the copy of these files in the working tree) does both of these inside `withTransaction`:

- `authorizeTransaction` awaits `acquirer.authorize` before commit.
- `captureTransaction` takes `SELECT … FOR UPDATE` and then awaits `acquirer.capture` on that same open transaction. The comment in that image says the row lock is held while the call is in flight.

Each checkout therefore occupies one pool slot for both sleeps, about 500 ms on average. Five slots at half a second is about 10 checkouts/s. The measured plateau is 9/s.

Samples taken during the 20- and 80-user runs showed five sessions `idle in transaction` with `wait_event_type = Client`, and five other sessions merely `idle`. Postgres was waiting on the application, not the other way around. In `docker stats`, 100% is one core: the API peaked around 11% against a 50% ceiling for its 0.5 CPU cap, and Postgres peaked around 24% against a 30% ceiling for its 0.3 CPU cap. API RSS stayed about 165–170 MiB of 512 MiB. Memory did not fill, and the API was not at its CPU quota.

The working tree’s `authorize.ts` and `capture.ts` release the connection before the acquirer call. That code was not what answered on port 3000. This estimate is for the image that was running. A rebuild would be a different system and needs its own run.

## How excess load is turned away, and how it comes back

Checkout does not turn excess load away.

There is no rate limit and no 503 shedder on `GET` or `POST /pay`. Login can return 429 `too_many_attempts`; the public pay route cannot. The pool is configured with `connectionTimeoutMillis` 5000 (`PG_POOL_CONNECTION_TIMEOUT_MS` unset, default in the image’s `config.ts`). At 80 concurrent users the median checkout was 8.6 s and the p95 was 8.7 s, with zero timeout responses. Those requests waited in the pool queue and then completed. An unhandled error, if one occurred, would become HTTP 500 `internal_error` with no `Retry-After`. None occurred.

The process did not crash, so it did not need a restart. Compose `restart` is `no`; an OOM kill or a panic would stay down until something starts the container. RSS never approached 512 MiB, uptime was continuous through both probes, and `/healthz` stayed 200.

Recovery is the same process draining the queue. Dropping from 36 users to 4 brought p95 from 4.4 s back to 686 ms with every payment paid. Successful payments were not lost. See the row check below.

## Money check

Run id `capload-1793375189959` (420 links, all attempted):

| Check | Result |
|---|---|
| Links `paid` | 399 |
| Links `active` again | 21 |
| Paid links with one linked transaction | 399 |
| Those transactions `captured` at 1000 fils | 399 |
| Captured sum | 399000 fils |
| Duplicate `transaction_id` | 0 |
| Same reference on two transactions | 0 |

The 21 active links are the simulator declines and acquirer errors (21/420 ≈ 5%, in line with a 2% failure chance on each of two acquirer calls).

Nine of those failures left an **authorized** transaction and an **active** hold of 1000 fils, while the payment link was set back to `active`. That is 9000 fils still reserved, on links a later payer can check out again. References:

`capload-1793375189959-4`, `-135`, `-161`, `-162`, `-202`, `-243`, `-286`, `-335`, `-353`.

In the serving image, `pay.ts` calls `releaseReservation` on any capture that is not HTTP 200, and it does not void the authorization. A capture decline or a capture error therefore returns the link to the pool of payable links and leaves the hold. The working-tree `pay.ts` is different (it voids a definitive decline and does not release the reservation on a 5xx). The rows above were produced by the image.

Other rows from this session use prefixes `capsat-1793375387881` and `capwho-1793375492022` on the same merchant. They were not deleted.
