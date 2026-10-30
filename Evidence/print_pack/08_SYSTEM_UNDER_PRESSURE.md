# EXHIBIT FILE // CAPACITY & LOAD ANALYSIS
**CASE REF:** `FP-2026-AUDIT`  
**DOCUMENT:** 08_SYSTEM_UNDER_PRESSURE.md  
**EXHIBIT:** F — Under Load: Empirical Capacity & Bottleneck Profiling  
**DATE OF RECORD:** 30 October 2026  

---

## 1. Test Methodology & Resource Governance

Load testing was conducted under strict hardware resource ceilings matching production competition specifications: **1.00 vCPU and 1792 MiB RAM** total across all four service containers:
- **API (`apps/api`):** 0.50 vCPU, 512 MiB RAM
- **Database (PostgreSQL):** 0.30 vCPU, 768 MiB RAM
- **Settlement & Reporting:** 0.10 vCPU, 256 MiB RAM each

**Test Harness:** Closed-loop constant-virtual-user benchmark (`scripts/checkout-capacity.test.mjs`) executing a fixed 2-step hosted checkout flow:
1. `GET /v1/payment-links/:token`
2. `POST /v1/payment-links/:token/pay` (1,000 fils / 1.000 BHD, card PAN `4111111111114242`).

---

## 2. Empirical Load Test Results Table

The acceptance criteria ("Fast & Correct") required end-to-end $p95 \le 1,500$ ms with unexpected errors $< 1\%$. Baseline floor latency is $\sim 500$ ms due to card acquirer network simulation (two 100–400 ms delays).

```text
┌───────┬────────────┬──────┬───────────┬─────────┬──────────┬──────────┬────────────┬──────────────────┐
│ USERS │ CHECKOUTS  │ PAID │ 402 / 502 │ ERRORS  │ E2E P50  │ E2E P95  │ REQ / SEC  │ SLA BAR STATUS   │
├───────┼────────────┼──────┼───────────┼─────────┼──────────┼──────────┼────────────┼──────────────────┤
│ 1     │ 14         │ 13   │ 1 (sim)   │ 0       │ 577 ms   │ 751 ms   │ 1.7 /s     │ PASS (Fast)      │
│ 2     │ 31         │ 30   │ 1 (sim)   │ 0       │ 557 ms   │ 737 ms   │ 3.8 /s     │ PASS (Fast)      │
│ 4     │ 62         │ 59   │ 3 (sim)   │ 0       │ 542 ms   │ 742 ms   │ 7.3 /s     │ PASS (Fast)      │
│ 8     │ 79         │ 74   │ 5 (sim)   │ 0       │ 850 ms   │ 1,063 ms │ 9.2 /s     │ PASS (MAX LIMIT) │
│ 12    │ 77         │ 72   │ 5 (sim)   │ 0       │ 1,238 ms │ 1,868 ms │ 8.7 /s     │ FAIL (p95 > 1.5s)│
│ 20    │ 125        │ 123  │ 2 (sim)   │ 0       │ 2,000 ms │ 2,708 ms │ 9.3 /s     │ FAIL (Queueing)  │
│ 36    │ 104        │ 98   │ 6 (sim)   │ 0       │ 3,606 ms │ 4,400 ms │ 9.3 /s     │ FAIL (Queueing)  │
│ 80    │ 155        │ 151  │ 4 (sim)   │ 0       │ 8,550 ms │ 8,743 ms │ 8.9 /s     │ FAIL (Queueing)  │
└───────┴────────────┴──────┴───────────┴─────────┴──────────┴──────────┴────────────┴──────────────────┘
```

---

## 3. Bottleneck Analysis: Connection Starvation

The system hit an impenetrable ceiling at **8 concurrent users / 9.2 checkouts per second**. 

- **The Culprit:** The API's PostgreSQL connection pool is configured to **5 connections**. In the serving container image, `authorize` and `capture` held open database transactions and row locks while awaiting external acquirer network I/O ($\sim 250$ ms each, totaling $\sim 500$ ms per checkout).
- **The Arithmetic:** 5 connection slots $\div 0.50$ seconds hold time = **10 checkouts/second theoretical limit**. The measured 9.2–9.3/s plateau was connection pool exhaustion, not CPU or RAM saturation.
- **Resource Headroom:** During 80-user overload, API CPU peaked at only **11%** (against its 50% cap), Postgres CPU peaked at **24%** (against 30%), and RAM remained steady at **170 MiB** of 512 MiB.

---

## 4. Overload Survivability & Data Integrity

- **No Cascading Crashes:** Under 80 concurrent users ($10\times$ capacity), zero requests failed with HTTP 500 or timeout. Requests queued safely in the pg pool and completed successfully.
- **Instant Recovery:** Reducing concurrency from 36 back to 4 users immediately brought latency back to $p95 = 686$ ms with $100\%$ payment success (53/53 paid). Process uptime was continuous.
- **Financial Conservation:** In a complete run of 420 attempted links (`capload-1793375189959`), exactly 399 links were marked `paid`, and all 399 were verified captured at exactly 1,000 fils with zero duplicate records or phantom debits.

---

## 5. Measured vs. Estimated Capacity

- **CONFIRMED MEASURED CAPACITY:** **8 concurrent users ($\sim 9.2$ checkouts/sec)** on the historical container image.
- **ESTIMATED CURRENT-BUILD CAPACITY:** Current working tree source code decouples network I/O from database transactions (`payments/capture.ts`), releasing connections before the acquirer sleep. This architectural fix is estimated to scale to 20–25 checkouts/sec. However, because local Docker tools were unavailable in the audit environment, this improvement remains **empirically unmeasured**.

---

### Evidence Sources
- `Evidence/capacity_checkout_load_test.md` (Raw benchmark metrics and pool timings)
- `Evidence/agent-1-capacity-optimization.md` (Container resource cap definitions)
- Run ID `capload-1793375189959` (Financial integrity database audit)
- `apps/api/src/payments/capture.ts` (PostgreSQL connection release refactoring)

