# FilsPay features

Product work that was started and never shipped. Defects live in [bugs/Readme.md](../bugs/Readme.md). This file does not list them.

---

## FEAT-001 — Merchant refunds

**Ticket:** FP-300  
**Requested by:** Product  
**Was:** Never shipped. `POST /v1/refunds` answered `501 { "error": "not_implemented" }`. Helpers, the `refunds` table, and a dashboard drawer existed and were not connected.  
**Now:** Shipped behind `FEATURE_REFUNDS`. The Compose API service sets that flag. The code default in `apps/api/src/config.ts` stays off, so a deploy can turn the route back to 501 without a code change.

A merchant owner or finance user can return some or all of a captured payment. The same call writes the ledger, reverses the fee to the fil, reduces the next payout, tells the shop, and shows up on the timeline, the daily report, and reconciliation.

### What the merchant does

1. `POST /v1/refunds` or `POST /v1/merchants/:merchantId/refunds`.
2. Body: `{ transactionId, amountFils?, reason? }`. Leave `amountFils` out to refund whatever is still refundable.
3. Header: `Idempotency-Key`. The same key on a retry returns the same refund. A new key is a new attempt.
4. The merchant is the authenticated session or API key. A merchant id in the body is ignored. The path form must be that same merchant.

The dashboard drawer on the transaction page calls the same route. It is shown to owner and finance when `refundsEnabled` is true on `/v1/auth/me`, and only for `captured`, `partially_captured`, and `partially_refunded`.

### Who may refund

- The flag must be on. Off means 501.   
- Role is owner or finance.
- An admin impersonation grant is refused.
- `merchants.refunds_enabled = false` puts that merchant on hold (403). Unset means allowed.
- Another merchant's transaction is 404.

### Money

Amounts are integer fils. A refund cannot exceed what was captured and not yet refunded or reserved.

Each success posts a balanced ledger group:

- Debit `merchant_payable`, credit `card_scheme_clearing`, for the refund gross.
- If a fee is reversed: debit `platform_fee_revenue`, credit `merchant_payable`, for that fee.

Partial refunds each reverse their own share of the fee. The last refund, the one that returns the rest of the capture, reverses whatever fee is still outstanding, so the reversals add up to the fee that was charged.

### Payouts

`CloseBatch` still builds scheme lines and platform volume from captures only. In the same Bahrain business day it then subtracts succeeded refunds that no batch has claimed yet: gross loses `amount_fils`, fee loses the stored `fee_reversed_fils`. Those refunds are stamped with the batch id. A second close does not take them again.

A refund that happens after that day's batch is already closed or paid is not written back into the paid batch. It reduces the next open day. A day with only refunds can close with a negative net. No bank disbursement is recorded for a zero or negative net.

### What the shop sees

A successful refund enqueues one `refund.succeeded` outbox event. The webhook dispatcher can send it. The signature is over the same canonical body that is posted.

The transaction timeline records `refund_partial` or `refunded`. Reporting adds `refund_count` and `refund_gross_fils` on `merchant_daily_volume` for the Bahrain date. Reconciliation counts an unbatched refund in the pending net (`amount_fils` minus `fee_reversed_fils`), so the ledger, the closed batches, and the pending figure still meet. `refund_merchant_summary` counts each transaction's captured amount once per merchant per Bahrain day, and still sums every succeeded refund.

### Where it lives

| Piece | Path |
|---|---|
| Routes | `apps/api/src/routes/refunds.ts` |
| Hold and tenant check | `apps/api/src/refunds/initiateMerchantRefund.ts` |
| Ledger, fee, outbox | `apps/api/src/payments/processRefund.ts` |
| Drawer | `apps/web/src/pages/transactions/RefundDrawer.tsx` |
| Webhook type | `apps/api/src/webhooks/envelope.ts`, `apps/api/src/webhooks/dispatcher.ts` |
| Daily rollup | `apps/reporting/src/consumer/applyEvent.ts` |
| Close | `apps/settlement/internal/settlement/batch.go` |
| Reconciliation | `apps/api/src/settlement/query.ts` |
| Summary view | `db/migrations/0084_refund_merchant_summary_once.sql` |
| Flag | `FEATURE_REFUNDS` on the API service in `ops/docker-compose.yml` |
