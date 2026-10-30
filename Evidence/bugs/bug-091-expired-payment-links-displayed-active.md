# BUG-091 — Expired Payment Links Are Still Displayed as Active

## 1. Summary

An unpaid payment link remains `active` in the merchant list API, dashboard list, and dashboard detail after `expires_at`. The public API correctly derives `expired` on a fresh read. A checkout opened before expiry retains its previously fetched `active` state and payment form after expiry until it is refreshed or receives a payment error.

**Investigation date:** 2026-10-30. **Baseline HEAD:** `1c3f99e0c5478e1ff616898cdfc1cd6f5283172d`. Findings concern the working tree inspected on that date, not necessarily the process currently listening locally.

## 2. Classification

- **Current status: Confirmed.** Merchant API mismatch reproduced with actual source functions and an in-memory database double; dashboard and checkout rendering confirmed statically. Browser reproduction remains unverified.
- **Tracking status:** `confirmed-current` (before: unregistered; after: documented, unfixed).
- **Severity / priority:** **P2 Important / Medium.** Incorrect merchant lifecycle information, misleading active filters, and a checkout form that remains available after expiry affect a core journey. No new-payment expiry bypass was established; a P0/P1 financial-integrity classification is not justified by the display defect.
- **Category:** Frontend and merchant API status derivation.
- **Confidence:** High for the display root cause; database-backed payment execution was not tested.

## 3. Root Cause

This combines a missing merchant-facing **derived status** with stale frontend state:

1. `payment_links.status` intentionally stores only `active`, `reserved`, `paid`, and `canceled`. Migration `0020_payment_links.sql:19–21,35–37` explicitly describes expiry as a read-time calculation, with no sweep job. Remaining stored `active` after expiry is therefore expected persistence behavior, not proof of an absent database transition.
2. `serializePaymentLink` copies `row.status` directly (`serialize.ts:47–57`). `listPaymentLinks` uses that serializer and filters on stored status (`query.ts:70–80`), without considering `expires_at`. A fresh API request therefore still returns `active`; refreshing the dashboard cannot correct it. An active filter includes expired unpaid rows.
3. Both dashboard pages render the returned status without deriving expiry. The merchant status type and filters omit `expired` altogether.
4. Public reads use `derivePublicStatus`, which returns `expired` for stored-active rows when `expiresAt <= Date.now()`. Checkout fetches only when its token changes and never schedules an expiry update, polls, or derives status from `expiresAt`. A fetched `active` result stays in React state beyond its deadline.

**Classification of candidate causes:** backend merchant read calculation: confirmed; frontend status display/freshness: confirmed statically; missing stored expiration transition: not required by the current schema design; stale React snapshot: confirmed statically; shared/API/database cache: no such cache in the traced path, and no cache is required to explain the mismatch. HTTP intermediary caching was not investigated at runtime.

## 4. Affected Files and Functions

| Reference | Role and evidence |
| --- | --- |
| `db/migrations/0020_payment_links.sql:19–21,35–37` | Expiry is derived; four stored statuses; deadline is `TIMESTAMPTZ`. |
| `db/migrations/0074_payment_link_claims.sql:1–8` | Adds durable reservation ownership; legacy reservations require reconciliation. |
| `apps/api/src/paymentLinks/create.ts:43–57` | Validates future expiry, inserts the timestamp; stored status uses the DB default. |
| `apps/api/src/paymentLinks/serialize.ts:22–25,47–57` | Merchant DTO intentionally exposes raw status. |
| `apps/api/src/paymentLinks/query.ts:70–85` | Reads fresh rows, filters stored status, serializes without deriving expiry. |
| `apps/api/src/paymentLinks/read.ts:34–57` | Public read derives status from current server time. |
| `apps/api/src/paymentLinks/status.ts:25–38` | Paid/canceled take precedence; active expires at equality; reserved stays processing. |
| `apps/api/src/routes/paymentLinks.ts:132–149,157–194` | Merchant list and public read/pay delegate to those functions. |
| `apps/api/src/paymentLinks/pay.ts:42–75,83–106` | Database-time new-payment guard; owned-reservation recovery; authorize, capture, finalization. |
| `apps/web/src/types.ts:7–18,131–142` | Public type includes `expired`; merchant type does not. |
| `apps/web/src/pages/payment-links/PaymentLinkListPage.tsx:12–16,35–60,113–116` | Raw-status filters, fetch-on-dependency-change, raw badge beside expiry. |
| `apps/web/src/pages/payment-links/PaymentLinkDetailPage.tsx:49–66,131–140,172–183` | Uses list DTO, renders raw status, still offers cancel for expired stored-active rows. |
| `apps/web/src/pages/checkout/CheckoutPage.tsx:33–51,108–109,142–165,167–182,240–242` | One fetch per token; terminal views depend on fetched status; active form has no deadline check. |
| `apps/web/src/pages/checkout/CheckoutPage.tsx:64–81` | A rejected expired submission becomes terminal on HTTP 410. |
| `apps/web/src/api/client.ts:38–51` | Fetch wrapper returns response data without status derivation or application caching. |
| `apps/web/src/router.tsx:35` | Actual checkout route is `/pay/:token`. |

Line numbers refer to the inspected working tree.

## 5. Expected Behavior

- An unpaid, unreserved link displays `Expired` at or after its timestamp in merchant list/detail and public checkout.
- Expired links do not appear as currently active/payable; active filtering excludes them.
- An already-open page updates when its deadline passes, without requiring a reload or attempted payment.
- Backend independently rejects a new payment claim at or after expiry.
- Paid/canceled outcomes retain their terminal identity. The treatment of an already accepted reservation must preserve safe recovery and be explicit; it must not silently become an invitation for another payer.

## 6. Actual Behavior

| Situation | Current behavior | Verification |
| --- | --- | --- |
| Fresh merchant list for expired stored-active row | `status: active` | Source-function reproduction with database double |
| Dashboard list/detail for that DTO | Raw `active` badge, even alongside a past deadline | Static render trace |
| Merchant `active` filter | Includes expired stored-active rows | SQL predicate inspection |
| Fresh public read for same row | `status: expired`; checkout renders “Link expired” | Public source function reproduced; rendering traced statically |
| Checkout loaded before deadline and left open | Active form remains after deadline | Effect/state/render inspection; no browser test |
| New payment for expired stored-active row | Claim cannot match; normally HTTP 410, before authorize/capture | SQL inspection and mocked failed-claim reproduction |
| Reserved payment crossing deadline | Original bound request can resume; new payer cannot take over | Static claim predicate inspection; execution not tested |

## 7. Trigger Conditions

A link is created with future expiry, remains unpaid and uncanceled, and reaches that deadline. Merchant reads remain wrong even after a new fetch. The checkout-specific stale display requires loading while active and keeping that page open through expiry.

## 8. Technical Evidence

```sql
-- query.ts: merchant filtering uses the stored state only
AND ($2::text[] IS NULL OR status = ANY($2))
```

```ts
// serialize.ts
status: row.status,
// status.ts: fresh public reads independently derive expiry
return row.expiresAt.getTime() <= Date.now() ? "expired" : "active";
```

```sql
-- pay.ts: separate rules for a new claim and recovery of an existing one
(status = 'active' AND expires_at > now()) OR
(status = 'reserved' AND payment_key_hash = $3 AND payment_request_hash = $4)
```

The deadline is an absolute timestamp, so Bahrain-versus-UTC day windows are not this defect's cause. Application public reads use the Node clock while new claims use the Postgres clock; clock skew could affect exact boundary error classification, but was not reproduced or assigned a separate bug here.

## 9. Runtime Evidence

A PowerShell here-string was piped to `node --input-type=module`. The harness transpiled the current TypeScript modules with the installed TypeScript compiler and evaluated them in memory. `query`, `serialize`, `read`, and `status` were the actual source functions. A fabricated expired row was returned by a database double; there was no database connection, write, or payment call. For `pay`, financial functions were throwing sentinels; the database double returned no claimed row and then the expired row. Hashing used Node crypto. This verifies application control flow, **not execution of the SQL predicate by Postgres**.

Observed output (exit 0; assertions passed):

```json
{"scenario":"same expired fixture","merchant":"active","public":"expired","readQueries":2}
{"scenario":"expiry boundary","offsetMs":-1,"public":"expired"}
{"scenario":"expiry boundary","offsetMs":0,"public":"expired"}
{"scenario":"expiry boundary","offsetMs":1,"public":"active"}
{"scenario":"mocked expired claim rejection","statusCode":410,"body":{"error":"payment_link_expired"},"claimQueries":2,"financialCalls":0}
```

The following self-contained, read-only subset reproduces the merchant/public mismatch and exact public-status boundary from the checked-out source. It does not rely on `tsx` or write generated files. Run from the repository root in PowerShell:

```powershell
@'
import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const source = fs.readFileSync(`apps/api/src/paymentLinks/${name}.ts`, 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022
  }}).outputText;
  const module = {exports: {}};
  const require = id => {
    if (!id.startsWith('./')) throw Error(`Unexpected import ${id}`);
    return load(id.slice(2).replace(/\.js$/, ''));
  };
  new Function('require', 'module', 'exports', code)(require, module, module.exports);
  cache.set(name, module.exports);
  return module.exports;
}
const now = Date.now();
const row = {
  id:'fixture', merchant_id:'fixture-merchant', token:'fixture-token',
  amount_fils:'1000', currency:'BHD', reference:null, description:null,
  status:'active', expires_at:new Date(now-60000), reserved_at:null,
  transaction_id:null, created_by_type:'merchant_session', created_by_id:'fixture-actor',
  created_at:new Date(now-120000), paid_at:null, canceled_at:null,
  created_at_text:new Date(now-120000).toISOString(), merchant_display_name:'Fixture'
};
const pool = {query: async () => ({rows:[row]})};
const listed = await load('query').listPaymentLinks(pool,
  {checkoutBaseUrl:'http://example.invalid'}, {merchantId:row.merchant_id});
const publicLink = await load('read').getPublicPaymentLink(pool,row.token,60);
assert.equal(listed.paymentLinks[0].status,'active');
assert.equal(publicLink.status,'expired');
console.log({merchant:listed.paymentLinks[0].status, public:publicLink.status});
const originalNow = Date.now;
try {
  Date.now = () => now;
  for (const offset of [-1,0,1]) {
    const status = load('status').derivePublicStatus({
      status:'active', expiresAt:new Date(now+offset), reservedAt:null
    },60);
    assert.equal(status,offset<=0?'expired':'active');
    console.log({offsetMs:offset,status});
  }
} finally { Date.now = originalNow; }
'@ | node --input-type=module
```

## 10. Security / Financial / Functional Impact

**Display and payment acceptance are separate findings.** The display defect misleads merchants and permits card entry into a stale checkout form. It does not establish that a new payment can be accepted after expiry.

For a stored-active expired link, the actual claim SQL requires `expires_at > now()` before calling `authorizeTransaction`; a failed claim classifies an expired active row as HTTP 410 (`pay.ts:65–66`). `submittedAt` is passed through the route but is not used by that claim. The historical client-clock bypass in BUG-005 is not the root cause of this display defect.

**Completion after the deadline is possible in the source flow for a payment already reserved.** The same key/request may resume a reserved link without a deadline predicate (`pay.ts:48`); authorize/capture and finalization also do not recheck the link's deadline. An attempt claimed just before expiry can finish after it. Public reads show these rows as `processing`, not `expired`, even past the deadline. This is consistent with the documented durable recovery design, and is not evidence of a fresh expired-link claim bypass. Whether the product requires a strict completion cutoff is a human decision; never simply release an uncertain reservation or suppress recovery of a possibly successful charge. No post-deadline capture was executed in this investigation.

## 11. Safe Reproduction

The in-memory reproduction above requires no records or credentials. For a future browser check, use an **existing isolated local test link** with a short future deadline; do not change its timestamp or submit a payment:

1. Open `/dashboard/payment-links` and that link's detail. Record its future expiry and `active` badge.
2. Open its `/pay/:token` checkout before expiry and leave it open.
3. Wait until the deadline naturally passes. The source predicts the dashboard and open checkout retain their prior state.
4. Reload the dashboard list/detail: its fresh merchant response still says `active`.
5. Reload checkout or GET `/v1/payment-links/:token`: public status should now be `expired`, with the expired view.
6. Select the merchant active filter: the expired unpaid link still matches the stored-status SQL filter.

These browser steps were **not executed**. Do not submit card data as part of this reproduction. A database-backed rejection test belongs in an explicitly isolated, approved test environment.

## 12. Related Findings and Deduplication

- [BUG-005](bug-005-payment-link-paid-after-expiry.md): historical expiry bypass using client `submittedAt`; report header says fixed. Current claim uses database time. Its older body describes superseded code and must not be treated as current proof of payability.
- [BUG-006](bug-006-payment-link-double-charge.md): reservation takeover/double charging; distinct from expired status display. Current durable reservation ownership must be retained.
- [BUG-077](bug-077-older-payment-links-unreachable-in-dashboard.md): detail pagination; distinct cause.
- Searched existing `Evidence/bugs/` reports and registry, relevant `Evidence/implementation/` reports, `Evidence/agent-3-payments-checkout.md`, and historical documentation/source-investigation reports outside the prohibited instruction archive. No canonical expired-as-active display report was found. Existing IDs extend through BUG-090; BUG-091 is the next available ID.
- Workstream status counts: **1 confirmed-current** (this report); 0 fixed or newly verified payment-bypass bugs. No repository-wide status recount was performed.

## 13. Documentation Contradictions

- `docs/ARCHITECTURE.md:73–75` still says expiry trusts the paying client's clock; current claim uses Postgres time. Source wins.
- Migration 0020 says every reader derives expiry, while the merchant serializer deliberately returns raw status. Its reservation-timeout comments also predate durable ownership in migration 0074.
- `context/PAYMENT_FLOWS.md` describes reservation reclamation after timeout; current source permits only the original key/request to resume. `context/modules/apps-web.md` claims a checkout expiration countdown, but the inspected checkout has none, and its documented `/checkout/:token` route differs from current `/pay/:token`.
- `context/API.md` has stale creation/cancel shapes and checkout URLs; the inspected routes accept `expiresAt`, cancel with DELETE, and use `/pay/:token`.
- Reviewed the ADR index and ADR 0001. No dedicated payment-link expiration ADR is listed. ADR 0003/0004/0006 accounting/reporting conflicts and paused ADR 0005 do not determine this display calculation; no financial-policy decision was made here.
- Context documents were reviewed but left unchanged because this task explicitly permits only relevant bug documentation. No application implementation or interface changed.

## 14. Recommended Minimal Fix

1. Add a merchant-facing effective display status: stored `active` plus deadline at/before authoritative current time becomes `expired`; preserve reserved/paid/canceled identities. Do not substitute the public helper indiscriminately because merchants currently distinguish `reserved` from public `processing`.
2. Align merchant active/expired filtering with that calculation. Coordinate the merchant DTO type, filters, and consumers if exposing `expired` there; this is a recommended follow-up requiring interface review, not an implemented contract change. A UI-only label fix would leave active filtering semantically wrong.
3. Schedule frontend expiry recomputation/refetch for loaded rows and checkout, including after focus/visibility resumes; stop presenting the active payment form when an unpaid/unreserved link expires. Keep the server as the payment authority.
4. Preserve the database-time new-claim guard, idempotency binding, and recovery of uncertain payments. Do not add a sweep, store a new status, or alter schema merely to repair this derived display state. Define reserved-payment completion policy separately if needed.

## 15. Remaining Questions and Verification Limits

| Command/check | Actual outcome |
| --- | --- |
| `git status --short`, `git rev-parse HEAD` | Initially blocked by dubious ownership; succeeded with command-local `-c safe.directory='C:/Users/Projects/Reboot/The Handover/fils-pay'`. No global Git configuration changed. |
| Prerequisites | Node v22.23.2; npm 10.9.8; Go 1.23.1 (below documented 1.24 prerequisite); Docker CLI 28.3.2. |
| `docker info --format '{{.ServerVersion}}'` | Docker configuration/engine named-pipe access denied. No infrastructure started or migrated. |
| Environment | `ops/.env.docker` exists; variable names inspected without exposing values. Shell `DATABASE_URL` is unset. |
| Local TCP probes | `127.0.0.1:5432` and `:3000` reachable. TCP is not a database query or migration check. |
| GET `http://127.0.0.1:3000/healthz` and `/readyz` | Both HTTP 200. Running process revision unknown; readyz is not proof of a fresh database query. |
| Read-only in-memory source harness | Passed: merchant/public mismatch, public equality boundary, mocked expired rejection with zero financial calls. |
| `node --import tsx --test apps/api/src/paymentLinks/status.test.ts apps/api/src/paymentLinks/pay.test.ts apps/api/src/paymentLinks/serialize.new.test.ts` | Initial sandbox run failed before test bodies: tsx calls `os.userInfo()`, which fails with `uv_os_get_passwd ENOMEM`. During the authorized rebase/push follow-up, the same three files passed outside the sandbox as part of a 24-test focused run; all 13 payment-link unit tests passed. Database/browser limits below still apply. |
| `npm.cmd run typecheck` | Passed, exit 0 across workspaces, db, and scripts. |
| Database-backed route/payment suites | **Not run**: no configured, verified isolated migrated database; tests insert/update payment records, outside this investigation's constraints. |
| Browser, auth, proxy, tenant isolation, full checkout/settlement flow | **Not verified** in this documentation-only workstream. |

No real payments, simulator payments, DB mutations, seeding, migrations, schema changes, or application edits were performed. Existing unrelated working-tree changes, including registry edits, were preserved. Only this report and its registry entries are changed by this workstream.

**Recommended regression tests:**

- Merchant list and detail show expired at `now == expiresAt` and after; remain active immediately before; paid/canceled retain their state; reserved remains a distinct in-flight state.
- Active filtering excludes expired rows; expired filtering includes them correctly across pagination and tenant scope.
- With controlled frontend time and mocked fetch, a mounted checkout and merchant page cross the deadline without navigation, hide active payment controls, and recover correctly after a suspended/background tab resumes.
- A fresh public read and reloaded checkout show expired; no client-clock manipulation can change backend new-claim eligibility.
- On a disposable DB, a fresh expired claim returns 410 and invokes neither authorize nor capture; cover exact equality, forged `submittedAt`, and the race between read and claim. Existing tests are `routes/paymentLinks.test.ts:208–223` and `paymentLinks/forkBatch2.new.test.ts:25–29`; these were inspected, not executed.
- Separate lifecycle tests establish the approved policy for a valid pre-expiry reservation crossing expiry, same-owner recovery, different-payer rejection, and paid-response replay, without duplicate charges.

## 16. Original Reports Merged

None. BUG-091 is distinct from the historical BUG-005 payment-acceptance bypass. The checkout freshness observation is documented here as a companion symptom; its separate frontend mechanism is explicit above.

## 17. Evidence References

Primary proof is current source and the in-memory output in sections 4, 8, and 9. Historical reports provide navigation only. No screenshots or database-backed payment artifacts were collected. Files changed: this report and [Readme.md](Readme.md), with targeted registration only. Application/context files were not changed.
