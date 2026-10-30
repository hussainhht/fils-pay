# Brief: build the FilsPay final-pitch slide deck (PDF)

You are building the **pitch slide deck** for a hackathon team's FilsPay submission. This file is self-contained: it says what to produce, the slide-by-slide content, every fact available from the project, and what you must **not** invent.

- Deliverable: **one PDF named `<TeamName>_FilsPay_Slides.pdf`** (team name is not known yet, see section 9).
- Audience: judges at the final. The team gets **4 minutes to pitch, then 7 minutes of questions**. The deck must be readable fast: one idea per slide, big type, few words.
- Source of truth for the rules: `Evidence/FilsPay_Submission_Guidelines_261030_161113.pdf`. Judging criteria: `Evidence/judgement_criteria_breakdown.md`.
- Repo root: `C:\Users\hanwd\OneDrive\Desktop\ff\fils-pay` (branch `main`).

## 1. Hard rules from the submission guidelines

1. Everything is due **Friday 11 pm**. Nothing can change after that (code, server, documents, slides).
2. The slide PDF is separate from the "Submission document" PDF (`TeamName_FilsPay_Submission.pdf`). **You build only the slides.**
3. The deck is only presented if the team qualifies for the final. Slides outside the Appendix are what is presented; **the Appendix is not presented**, so put everything the judges should see but cannot be said in 4 minutes there (queries, test output, diagrams, load-test graphs).
4. Judges score what the team can explain or show working. Do not put claims on a slide that the evidence below does not support.

### Judging criteria (170 points), use these to decide emphasis

| Area | Pts | Relevance to slides |
|---|---|---|
| Correctness | 100 | Findings, root causes, fixes with proof |
| Capacity | 20 | Estimated vs measured users, bottleneck, overload behaviour |
| Hosting architecture | 10 | Live, secure, reproducible; whole stack on 1 vCPU / 2 GB, API capped at 0.5 vCPU / 512 MB |
| AI usage and setup | 10 | Setup files in repo; how the team verified AI output (not how much it was used) |
| UI and UX | 10 | Checkout, merchant dashboard, admin console, before/after |
| Technical defence | 20 | Whole team presents and answers technical questions |

## 2. Required slide structure (from the guidelines), 8 slides + Appendix

| # | Slide | What to show |
|---|---|---|
| 1 | Team | Team name, members, who owned what |
| 2 | Root cause | The biggest underlying problem in one sentence, and the symptoms it explains |
| 3 | Key findings | Top 3-4 findings ranked by impact, one line of evidence each |
| 4 | Fixes and proof | What changed and the test/query/before-after that proves it |
| 5 | Live demo | A full refund and a partial refund end to end, correct amounts in the dashboard and the settlement report. **Include screenshots in case the live demo fails** |
| 6 | Under load | Architecture, estimated vs measured capacity, how the stack handles overload |
| 7 | How you used AI | Setup in one line + one time the AI was wrong and how the team caught it |
| 8 | Decisions and open risks | What was deliberately not changed or run, why, and what is still open |
| App. | Appendix | Not presented. Queries, test output, diagrams, load-test graphs |

Keep slides 1-8 to **one screen of content each**. Speaker notes (short, ~25 s per slide) are welcome if the PDF export supports them; otherwise put them in a separate `.md`.

## 3. Product context (one paragraph for the agent)

FilsPay is a multi-tenant payment gateway and merchant-acquiring platform for Bahrain. Money is stored as **integer fils** (1 BD = 1,000 fils; `4.750 BD = 4,750 fils`); a double-entry ledger with a deferred balance trigger records money movement; a Go settlement service closes the Asia/Bahrain business day, calculates fees and payouts; a TypeScript reporting service builds analytics from a transactional outbox. The challenge repo was seeded with many deliberate defects, plus misleading docs/ADRs/comments ("decoys"), and the team had to find, fix, prove and report them.

Stack: npm workspaces, TypeScript ESM, Fastify API (`apps/api`), Go settlement (`apps/settlement`), reporting worker (`apps/reporting`), React/Vite merchant dashboard + hosted checkout (`apps/web`, port 5173), React/Vite ops console (`apps/admin`, port 5174), PostgreSQL 16, Docker Compose. Protected/frozen: `packages/money/` and the partner contract in `apps/api/src/v1/` (not modified).

## 4. Findings data (for slides 2, 3, 4, 8 and Appendix)

Registry: `Evidence/bugs/Readme.md` (BUG-001..BUG-091, one report per bug in `Evidence/bugs/bug-NNN-*.md`). Registry status table counts: **Fixed 83, Fixed (fresh DB) 1, Fixed (local boot) 1, Partial 2, Open 3**. Original audit snapshot: 84 unique bugs, 14 Critical / 44 High / 22 Medium / 4 Low; 13 runtime-reproduced, 71 statically confirmed. The registry itself warns that historical counts describe different snapshots, so on the slide say **"~90 catalogued defects"**, and quote the exact numbers only in the Appendix with the snapshot date. `Evidence/POST_MERGE_AUDIT_REPORT.md` is a later audit at HEAD `c3eb218`: 13 distinct current defects (1 P0, 6 P1, 5 P2, 1 P3), 12 earlier fixes verified at unit/functional scope, 144 safe tests passing.

### 4.1 Root cause (slide 2). Suggested one-liner

> **Invariants were written down (docs, ADRs, comments) but not enforced where the money moves.** Trust was placed in client input, comments and passing tests instead of server-side checks and atomic database transactions.

Group the symptoms under this root cause (these groupings are the team's synthesis of the registry; they are not a quote from it):

| Cause group | Symptoms (bug IDs) |
|---|---|
| Missing server-side authorization / tenant scoping | Login without OTP (001); OTP sent to another merchant (002); cross-merchant refund (003); impersonation had write access (004); payment-link cancel across merchants (018); reporting IDOR / unauthenticated export (019, 020); credits without role check (041) |
| Wrong money type/units | CSV import 10x too small (009); float32 net payout (010); split payouts lose fils (030); int32 volume overflow (031); float32 lifetime estimate (063); promo discount x100 (088); progress bar /10000 (082) |
| Multi-step writes not atomic / not idempotent / racy | Payment-link double charge (006); concurrent refunds double payout (008); OTP attempt race (015); duplicate callbacks/payout notices (048, 049); reporting double-apply (052); webhook dispatch with no claim (069); analytics rebuild non-atomic (074) |
| Time-zone / time-source errors | Link paid after expiry via client `submittedAt` (005); daily close at 03:15 (036); UTC-midnight date filter (076); exclusive end date included (084) |
| Docs/ADRs/comments that legitimised bugs | ADR 0003 (UTC month), 0004 (console rebuild from settled data), 0006 (cache-only adjustments); `docs/HANDOVER.md` invariants the code contradicts; old agent-instruction files say "1 BD = 100 cents / Math.random is fine" |
| Ops / deployment | Fresh DB migrations broken (014); seed truncates DB (054); committed secret and broken compose (057, 058) |

### 4.2 Top findings to rank for slide 3 (suggested order, adjust to what the team can demo)

1. **Login granted full access without OTP** (BUG-001) and **OTP/session bound to a different merchant** (BUG-002): tenant takeover. Both fixed; session-promotion/rotation covered by BUG-016.
2. **Refund integrity**: refunds returned 501 (BUG-027), over-refund beyond captured (007), concurrent refunds paid twice (008), cross-merchant refund (003). Fixed and shipped as a working feature behind `FEATURE_REFUNDS`; ledger-balanced, fee reversed to the fil, reduces next payout (`Evidence/features/features.md`).
3. **Money precision**: BHD parsed as 2 decimals (009, 10x), float32 payouts (010), fee formulas diverging between TS and Go (032), fils lost in split payouts (030).
4. **Settlement / ledger correctness**: scheme export rounded while ledger truncated (034), MDR recalculation rewrote paid batches (035), reconciliation subtracted paid batches twice (065), "recalculate balances" wrote the wrong source (011, the FP-203 135K to 7K story).
5. **Concurrency**: payment-link double charge (006).

For each finding, the Appendix should carry: symptom, reproduction, root cause, fix, verification, and effect on existing data (that is the Submission-document format; slides use one line plus proof).

### 4.3 Fixes and proof (slide 4)

Pick 2-3 fixes and show a before/after plus the test or query. Evidence locations:
- Per-bug reports with fix notes: `Evidence/bugs/bug-*.md`
- Implementation reports: `Evidence/implementation/agent-1..6-*.md`, `wave1-validation.md`, `wave1-smoke.mjs`, `migrations-validation.sql`
- Targeted fixes: `Evidence/PMA-01_OTP_DELIVERY_FIX.md` (production OTP delivery was log-only; now Resend HTTPS adapter, sanitised 503 on failure, no raw OTP logged), `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md` (BUG-033: March sweep script retired so it can never post financial adjustments again; direct execution refuses and exits 1), `Evidence/MICROSOFT_AUTHENTICATOR_INTEGRATION.md` (optional TOTP), `Evidence/webhook_audit_and_implementation.md` (bounded retries, `payment.failed`, `payment_link.expired` events), `Evidence/balance_reconciliation_fix.md`.
- Migrations added in this work include `0078_settlement_paid_once`, `0079_ledger_audit_immutability` (ledger/audit tables now immutable by trigger), `0080_bigint_counters`, `0081_callback_id_unique`, `0082_adjustment_import_idempotency`, `0083_payout_disbursement_unique`, `0084_refund_merchant_summary_once`, `0085_authenticators`.
- Verification numbers that are documented: money package 40/40 tests; events 4/4; web tests 28 pass (after the UI polish pass; earlier UI work reported 45/45 for a different test set, so quote only the run you re-execute); post-merge audit: 144 safe tests, 90 baseline test files all still present, 491 files scanned with zero merge-conflict markers; `npm run typecheck` passes across all workspaces. **API/reporting database-backed tests need a migrated Postgres. If the agent cannot re-run them, state "not run" instead of "passed".**

Re-run before slide time if possible: `npm run typecheck`, `npm run test -w @filspay/web`, `npm run test -w @filspay/money`. On Windows PowerShell use `npm.cmd`.

### 4.4 Live demo (slide 5)

Required scenario: **full refund and partial refund end to end, with correct amounts in the dashboard and the settlement report.** The slide is a storyboard plus **screenshots as a fallback**.
- Merchant flow: hosted checkout `/checkout/:token` (1000 fils = 1.000 BD test payment; test PAN suffixes: `...0002` declined, `...0119` insufficient funds, `...0069` acquirer error), transaction detail page, Refund drawer (owner/finance only, `POST /v1/refunds` with `Idempotency-Key`; amount omitted = refund everything still refundable), then settlement batch detail and reconciliation page.
- Money rules to narrate: refund cannot exceed captured minus refunded/reserved; each success posts a balanced ledger group (debit `merchant_payable`, credit `card_scheme_clearing`; fee reversed to the fil); the refund reduces the next payout.
- **No screenshots exist in the repo.** The team must capture them, or the agent can generate fixtures with `node scripts/checkout-preview.mjs` (loopback fixture; `--before` serves the pre-redesign checkout). Never fabricate screenshots, amounts or ledger rows. Leave a clearly labelled `[SCREENSHOT NEEDED: ...]` placeholder instead.

### 4.5 Open risks and deliberate non-changes (slide 8)

Sourced from the registry and audits. State each as: what, why not changed, proposed safeguard.
- **Open in the registry:** BUG-024 (void does not reverse the acquirer authorization hold), BUG-073 (leading-wildcard `ILIKE` full scan on transaction search), BUG-081 (migration runner has no checksum). **Partial:** BUG-043 (backdated credits into closed periods), BUG-057 (committed acquirer secret: code remediated, **external credential rotation still outstanding**). BUG-091 (expired payment links displayed as active) was `confirmed-current` in the registry.
- **Human decisions, deliberately not "fixed" silently:** ADR 0003 (UTC calendar-month windows vs Asia/Bahrain), ADR 0004 (console rebuild from settled data vs ledger as the source), ADR 0006 (display-only balance adjustments). They conflict with the ledger-is-authoritative invariant and need an accounting decision. ADR 0005 (shadow ledger) is Proposed/paused: not implemented on purpose.
- **Protected / frozen:** `packages/money/` and `apps/api/src/v1/` were not changed.
- **Not run on purpose:** `npm run seed` (destructive TRUNCATE; needs `ALLOW_DESTRUCTIVE_SEED=1` on an isolated DB only); real provider/payment calls; the historical March residue sweep (retired, PMA-08). **Historical financial impact of any earlier sweep run is unverified** (no DB-level investigation was possible).
- **Dependencies (`Evidence/security_tool_scan.md`):** `npm audit` shows production 5 advisories (4 moderate, 1 high: `sharp` 0.33.5, needs breaking bump to 0.35.5), full tree 8 (3 high). Fastify HTTP/2 advisory not on the request path (HTTP/2 not enabled). react-router 6.x advisories need a major bump. Not upgraded (no new dependencies without approval). `govulncheck` was also run; read the rest of that file for the Go result. k6, semgrep, trivy, gitleaks, ZAP were not installed or run.
- **Deployment limits:** no TLS/domain yet; no off-host backup/restore schedule; no alerting; email OTP provider (Resend) acceptance and real delivery not verified; browser automation was unavailable in earlier sessions, so rendered visuals were never visually verified by an agent.

## 5. Architecture, deployment and capacity (slide 6 + Appendix)

### 5.1 Architecture facts (draw a real diagram; do not invent services)

| Service | Port / exposure | Notes |
|---|---|---|
| nginx (host) | 80 public (443 allowed by firewall, no cert yet) | Serves merchant + admin SPAs, proxies API, returns generic 503 JSON when API is down |
| API (Fastify) | `127.0.0.1:3000` (loopback only) | Limited to 0.5 vCPU / 512 MB in the judged environment |
| Settlement (Go) | 8091, **internal Docker network only** | Authenticated internal HTTP, daily batch close at Asia/Bahrain midnight |
| Reporting worker | no port | Consumes outbox, builds analytics read model |
| PostgreSQL 16 | **no host-published port** | Separate non-superuser roles for API, reporting, settlement; migration uses owner role |
| SSH | 22 | Admin access |

Local dev: web 5173, admin 5174 (Vite proxies `/v1` and `/healthz` to API 3000). Only SSH and nginx 80 are public.

- Dev stack: `docker compose -f ops/docker-compose.yml up --build -d`, then `node ops/setup-env.mjs` and `node ops/preview.mjs`.
- Production: `ops/docker-compose.production.yml` (`restart: unless-stopped`, healthchecks, explicit migration job, no seed service), `ops/nginx.production.conf`, `ops/Dockerfile.production.node`, runbook `ops/PRODUCTION.md`. Redeploy command in the runbook is `sudo docker compose -p filspay -f ops/docker-compose.production.yml up -d <service>`. Production images are tagged `20261030-1f88a47` for rollback. **Read `ops/PRODUCTION.md` and confirm the single redeploy command before printing it on a slide.**
- Secrets: generated **on the server only**, in root-only mode-0600 files under `/etc/filspay`; never in git, chat or logs. Committed development secret (BUG-057) was removed from code; rotation of the old credential is still owed.
- "How a redeploy avoids interrupting a settlement run": the guidelines ask for this, and **the repo does not yet document a verified answer**. Do not make one up; list it under open risks unless the team supplies one.

### 5.2 Live deployment status (as recorded 2026-10-30)

`Evidence/agent-1-server-deployment.md`: server `68.183.82.221` (Ubuntu 24.04, 1 vCPU, ~2 GiB RAM + 2 GiB swap).
- Merchant `http://68.183.82.221/dashboard/login` and admin `http://68.183.82.221/login` returned 200 (HTTP, frontend preview).
- **At that time the API was deliberately not activated** (`/healthz` and `/v1/*` returned a generic 503) because the production OTP delivery requires a real Resend sender/API key and valid HTTPS. Database initialised with all 79 migrations, zero merchants/admins/seeded data.
- **Ask the team for the current URLs and API state before the deck is final.** The deck must not imply a working checkout/API if it is still a 503.

### 5.3 Capacity (`Evidence/capacity_checkout_load_test.md`, measured 2026-10-30)

- **Estimate: 8 concurrent simulated users**, plateau about **9 checkouts/s**. Bar: p95 end-to-end (GET link + POST pay) <= 1500 ms and <= 1% unexpected failures.
- Method: Node.js 22 `fetch` closed-loop runner (k6 not installed), fixed scenario = `GET /v1/payment-links/:token` then `POST .../pay` (1000 fils, `Idempotency-Key`), one fresh link per iteration, about 8 s per level. Container caps applied only for the run: API 0.5 CPU / 512 MiB, postgres 0.3 / 768 MiB, settlement 0.1 / 256 MiB, reporting 0.1 / 256 MiB (total 1.0 vCPU / 1792 MiB).

| Users | p50 | p95 | Checkouts/s | Inside bar |
|---:|---:|---:|---:|---|
| 1 | 577 ms | 751 ms | 1.7 | yes |
| 2 | 557 ms | 737 ms | 3.8 | yes |
| 4 | 542 ms | 742 ms | 7.3 | yes |
| 8 | 850 ms | 1063 ms | 9.2 | yes |
| 12 | 1238 ms | 1868 ms | 8.7 | no |
| 20 | 2000 ms | 2708 ms | 9.3 | no |
| 36 | 3606 ms | 4400 ms | 9.3 | no |
| 80 | 8550 ms | 8743 ms | 8.9 | no |

- **Bottleneck:** the API's Postgres pool of **5** connections held open across two acquirer-simulator sleeps (100-400 ms each) in the *measured image*. 5 slots x about 0.5 s = about 10 checkouts/s. API CPU peaked about 11% of 50% quota; RSS about 170 of 512 MiB; five sessions "idle in transaction" waiting on the app. The floor for one user is about 750 ms p95.
- **Overload behaviour (be honest):** checkout does **not** shed load: no rate limit or 503 shedder on `GET` or `POST /pay`; excess requests queue in the pool (5 s connection timeout). At 80 users: no HTTP 500s, no timeouts, process stayed up; dropping back to 4 users returned p95 to 686 ms with 53/53 paid. Compose restart policy was `no` in the dev stack; production compose uses `unless-stopped`.
- **Money check:** run `capload-1793375189959`, 420 links: 399 paid, 399 transactions captured at 1000 fils = 399,000 fils, 0 duplicate transactions. 21 links returned to `active` (simulator declines/errors). **Nine** failures left an *authorized* transaction with an active 1000-fils hold while the link went back to `active` (9,000 fils reserved), a finding in the measured image's `pay.ts`.
- **Important caveat to put on the slide:** the measured image was **not** the working-tree code. The working tree's `authorize.ts`/`capture.ts` release the DB connection before the acquirer call, and its `pay.ts` voids a definitive decline. A rebuild would be a different system and needs its own run. The team should **re-run the load test on the final deployed build** and update the table; label estimate vs measured clearly (guideline asks for "estimated vs measured capacity").

## 6. UI/UX changes (slides optional, Appendix required)

The guidelines ask for each change: what, why it mattered, **before and after screenshots**. Evidence: `Evidence/ui_ux_redesign.md`, `Evidence/ui_checkout_redesign.md`.
- Shared design system `apps/ui/` (`tokens.css`, `workspace.css`, `primitives.css`, `refinements.css`, `polish.css`; `Brand.tsx`, `Icon.tsx`, `PageHeading.tsx`), imported by merchant dashboard, admin console and checkout. Deep-green brand, system fonts (no external requests), restrained radius/shadows.
- Layout: 232px sidebar with consistent icon set and active-edge indicator; tablet/mobile collapse to grid navigation; page headings with actions aligned.
- Tables: named, keyboard-focusable scroll regions (UI-A11Y-001: 13 failing tests at baseline, passing now), tabular numerals for money, selected-row tint, compact admin rows.
- Forms/buttons/states: consistent fields and focus ring, primary/secondary/**danger**/ghost buttons (danger on Cancel link, Void, Delete webhook, Reject credit, Reject KYC), pill status badges with dot, left-accent notices, loading pulse, reduced-motion support.
- Auth screens (both planes) use the same wordmark and panel composition; checkout has a branded masthead, amount hierarchy, grouped card fields with proportional expiry/CVV grid, and success/failure result states.
- Preserved: all routes, role gates, API calls, financial formatters. No fake metrics or unsupported trust claims (no security-certification badges).
- **No before/after screenshots are saved anywhere in the repo.** The team must capture them (`node ops/preview.mjs` runs web 5173 / admin 5174; `node scripts/checkout-preview.mjs --before` serves the original checkout). Use labelled placeholders, never mock images.

## 7. AI usage (slide 7 + Appendix)

Slide 7 is deliberately small: setup in **one line** and **one time the AI was wrong and how it was caught**.

**AI setup that lives in the repo** (the repo must include all AI setup files):
- `AGENTS.md`: shared authority (architecture, commands, safety rules, severity P0-P3, bug status taxonomy, Definition of Done, git safety)
- `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/filspay.mdc`: tool-specific adds that defer to `AGENTS.md`
- `context/`: a persistent knowledge base (README router table, ARCHITECTURE, DATABASE, API, AUTH_AND_SECURITY, PAYMENT_FLOWS, FRONTEND, TESTING, KNOWN_ISSUES, DEPENDENCY_MAP, DECISIONS, CHANGELOG, `modules/*`), updated after every task
- `Evidence/`: per-workstream reports and the bug registry (each report states baseline HEAD, commands actually run with real outcomes, per-bug before/after status, and what was not verified)
- Operating rules encoded for agents: read docs as leads not proof; confirm each defect against current code; regression test with every fix; no touching `packages/money/`, migrations or the `v1` contract without approval; no seed/destructive git; never claim end-to-end success without runtime evidence; the old agent-instruction directory `Evidence/old-agints-instration/` is a decoy and must not be read
- Note: `.claude/` does not exist in the repo; custom slash commands/permission files are not present. **Do not claim them.** Ask the team whether any exist outside the repo.

**Candidate "AI was wrong" material already documented** (verify before use; the team must confirm what actually happened):
- Docs/ADRs/handover contained false statements about the code that an AI would repeat if it trusted them: ADR 0002 says scheme residue posting is "implemented" (it was not at baseline); `docs/HANDOVER.md` says holds are never deleted (the janitor ran `DELETE`) and impersonation is read-only (it granted writes); `docs/ONBOARDING.md` says tests are the tie-breaker (tests had been locked to buggy behaviour). The old agent-instruction files told agents "1 BD = 100 cents" and "`Math.random` is fine". The team's countermeasure was the rule "confirm against current code".
- `context/` itself went stale: `context/README.md` claimed 72 migrations and no scheme-residue posting; `POST_MERGE_AUDIT_REPORT.md` shows the code has 78+ migrations and `batch.go:304-327` posts residue. This is a clean example of an AI-written knowledge base being wrong and the audit catching it.
- Another real data point: a first server-render test run failed with `React is not defined` in shared JSX outside the app tsconfig boundary; fixed with explicit imports, not by weakening the test (`Evidence/ui_ux_redesign.md`).

**Three annotated transcript excerpts are required in the Submission document, not the deck.** No transcripts are stored in the repo. Slide 7 should reference them, and the Appendix can include one condensed excerpt if the team supplies it. Do **not** invent prompts or AI replies. Each excerpt needs: the finding it supports, the prompt and the context/tools the AI had, the relevant part of the answer, how it was verified and what that showed, and what changed; at least one must show the AI being wrong.

## 8. Team and ownership (slide 1)

Git authors with real activity on the final code: **hussainali7** (35 commits) and **qalnasha** (22 commits). Other names in history (Yousif Al-Ansari, Mahmood Khalil, Fatima Haji, Ali Marzooq) are characters from the challenge's fictional case file, **not team members**. Do not list them.

Observed ownership from commits and reports (confirm with the team before printing):
- hussainali7: refunds/scoped refunds, payment-link/refund tests, OTP delivery + TOTP, webhooks (`payment.failed`, `payment_link.expired`, bounded retries), UI redesign + polish, server deployment, context/Evidence documentation.
- qalnasha: OTP session enforcement and authentication attempt serialisation, refund completion so payouts/reconciliation match the ledger, money/auth/reporting fixes.

Submission links (also needed on the Submission document's cover page): fork remote in this checkout is `origin = https://github.com/hussainhht/fils-pay.git`; the challenge repo is `upstream = https://github.com/MJ5-byte/fils-pay.git`. **The submitted link must be the team's own public fork.** Confirm that `origin` is the public fork. Latest commit at the time of this brief: `1f88a47ee619e87728219ad531df4dc4e4cbad56`. It will change; **ask for the last commit before the deadline**.

## 9. Inputs the agent must request from the team (do not guess)

1. **Team name** (for the filename and slide 1), full member names and final role per person.
2. **Live URLs**: checkout, merchant dashboard, admin console, public API; whether the API is currently up.
3. **Fork URL** and **last commit ID before 11 pm**.
4. **Screenshots**: refund demo (full + partial, dashboard + settlement report), UI before/after for checkout, dashboard, admin.
5. **AI transcript excerpt(s)**, especially the AI-was-wrong case.
6. Whether a **fresh load-test run** exists on the final deployed build, and the answer for "how a redeploy avoids interrupting a settlement run".
7. Any brand assets/logo (otherwise use the existing wordmark in `apps/ui/Brand.tsx`).

If an input is missing, put a visible `[NEEDED: ...]` placeholder on the slide and list the missing items in your final message. Never fill a gap with invented data.

## 10. Design guidance for the deck

- 16:9, large type (title >= 36 pt, body >= 20 pt), at most about 40 words per slide, one message per title (write titles as claims, e.g. "Refunds now balance to the fil").
- Match the product: deep green primary `#087f5b` (hover `#064e3b`, soft `#eaf5ef`), neutrals `#172c25` text, `#586b63` muted, white cards on `#f6f8f7`; danger `#a3293e`, warning `#855516`. System/Inter-style sans, tabular figures for money. Money is always displayed as `X.YYY BD`.
- Prefer a real diagram (architecture, ledger flow, load curve chart of users vs p95 and throughput) to bullet lists. Charts must be accurate and labelled with units; use the table in section 5.3 for the data.
- Slide 6 must visibly distinguish **estimated** (8 users) from **measured**, and say what happens beyond the limit.
- Slide 8 reads as responsible engineering: every open item has a reason and a proposed safeguard.
- Appendix slides: findings table with status, ledger/refund SQL or test output, load-test chart, deployment diagram, dependency-scan summary, UI before/after grid. Mark each appendix slide "Appendix, not presented".
- Export a single PDF named exactly `<TeamName>_FilsPay_Slides.pdf`; check fonts embed, no overflow, readable at projector resolution.

## 11. Do-not list

- Do not invent metrics, screenshots, transcripts, URLs, commit IDs, test counts or team members.
- Do not say "the system works end to end" unless the team supplies runtime evidence. Prior reports record that Docker/Postgres were unavailable on the dev machine in several sessions, and that API/reporting DB tests were *not run* there.
- Do not claim ledger integrity of historical data (the March-sweep impact is unverified).
- Do not present bug counts as a success metric; the repo's own rule is that the ranked impact of top findings matters more than the total.
- Do not copy text from `Evidence/old-agints-instration/` (decoy; the owner directed it not be read).
- Do not include secrets, tokens, SSH details or `.env` values anywhere.

## 12. Source map (read these to fill details)

| Need | File |
|---|---|
| Rules, structure, deadlines | `Evidence/FilsPay_Submission_Guidelines_261030_161113.pdf` |
| Judging points | `Evidence/judgement_criteria_breakdown.md` |
| Bug registry and statuses | `Evidence/bugs/Readme.md`, `Evidence/bugs/bug-NNN-*.md` |
| Fix reports and validation | `Evidence/implementation/*`, `Evidence/PMA-01_OTP_DELIVERY_FIX.md`, `Evidence/PMA-08_RECONCILIATION_SAFETY_FIX.md`, `Evidence/MICROSOFT_AUTHENTICATOR_INTEGRATION.md`, `Evidence/webhook_audit_and_implementation.md`, `Evidence/balance_reconciliation_fix.md` |
| Latest audit | `Evidence/POST_MERGE_AUDIT_REPORT.md`, `Evidence/finance_ops_security_audit.md`, `Evidence/security_tool_scan.md`, `Evidence/trailofbits-audit/` |
| Refund feature spec | `Evidence/features/features.md` |
| Capacity | `Evidence/capacity_checkout_load_test.md` |
| Deployment | `Evidence/agent-1-server-deployment.md`, `ops/PRODUCTION.md`, `ops/docker-compose.production.yml`, `ops/nginx.production.conf` |
| UI/UX | `Evidence/ui_ux_redesign.md`, `Evidence/ui_checkout_redesign.md`, `apps/ui/` |
| AI setup | `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.cursor/rules/filspay.mdc`, `context/` |
| Architecture and flows | `context/ARCHITECTURE.md`, `context/PAYMENT_FLOWS.md`, `context/DEPENDENCY_MAP.md`, `docs/ARCHITECTURE.md` |

Some of these files were produced by other agents and may be stale. Where reports disagree, the code and the freshest dated report win; flag any conflict you see instead of silently choosing.
