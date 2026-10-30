import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { ZERO_FILS, addFils, compareFils, subtractFils, toFils, type Fils } from "@filspay/money";
import { enqueueEvent } from "@filspay/events";
import { withTransaction } from "../db/withTransaction.js";
import type { AcquirerCaptureResult, AcquirerSimulator } from "../acquirer/types.js";
import { calculateDiscountedMdrFee } from "../v1/fees/calculateFee.js";
import { claimIdempotencyKey, completeIdempotencyKey, failIdempotencyKey, hashRequest, singleFlight } from "./idempotency.js";
import { recordTransactionEvent } from "../transactions/events.js";
import { serializeTransaction, type TransactionRow } from "../transactions/serialize.js";
import { ConflictError, UnprocessableEntityError } from "../lib/errors.js";
import { nextStatusAfterRefund } from "./refundState.js";
import { getEffectiveMdrBps } from "../fees/feeSchedule.js";
import { getVolumeTierBonusBps } from "../fees/platformVolumeTier.js";

async function recordCaptureMetric(
  client: PoolClient,
  merchantId: string,
  amountFils: Fils,
  capturedAt: Date,
): Promise<void> {
  const dateStr = capturedAt.toISOString().slice(0, 10);
  const existing = await client.query(
    `SELECT merchant_id FROM merchant_daily_volume WHERE merchant_id = $1 AND volume_date = $2`,
    [merchantId, dateStr],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE merchant_daily_volume
          SET captured_count = captured_count + 1, captured_gross_fils = captured_gross_fils + $3
        WHERE merchant_id = $1 AND volume_date = $2`,
      [merchantId, dateStr, amountFils],
    );
  } else {
    await client.query(
      `INSERT INTO merchant_daily_volume (merchant_id, volume_date, captured_count, captured_gross_fils, voided_count)
       VALUES ($1, $2, 1, $3, 0)
       ON CONFLICT (merchant_id, volume_date)
       DO UPDATE SET captured_count = merchant_daily_volume.captured_count + 1,
                     captured_gross_fils = merchant_daily_volume.captured_gross_fils + $3`,
      [merchantId, dateStr, amountFils],
    );
  }
}

const ENDPOINT = "transactions.capture";

export interface CaptureInput {
  transactionId: string;
  merchantId: string;
  amountFils?: Fils; // omitted => capture the full remaining amount
  idempotencyKey: string;
  /** Includes 'system' (matching AuthorizeInput.actor and
   *  RecordTransactionEventInput.actor.type) so the payment-link checkout
   *  handler — which has no merchant session or API key of its own — can
   *  call captureTransaction() directly. routes/transactions.ts's capture
   *  route always supplies a real session/API-key actor. */
  actor: { type: "merchant_session" | "merchant_api_key" | "system"; id: string };
}

export interface CaptureResult {
  statusCode: number;
  body: unknown;
}

interface LockedTransactionRow {
  id: string;
  merchant_id: string;
  status: string;
  amount_fils: string | number;
  captured_fils: string | number;
  refunded_fils: string | number;
  acquirer_reference: string;
}

interface IdempotencyStateRow {
  status: "in_progress" | "completed" | "failed";
  response_status_code: number | null;
  response_body: unknown;
}

type PreparedCapture =
  | { kind: "done"; result: CaptureResult }
  | {
      kind: "proceed";
      claimId: string;
      recovering: boolean;
      acquirerReference: string;
      requestedAmount: Fils;
      transactionId: string;
    };

/**
 * `POST /v1/transactions/:id/capture` business logic. Integer math,
 * double-entry journaling, idempotent.
 *
 * The capture claim is committed before the acquirer call, and the external
 * operation id is the claim id. A retry resumes that same operation. The
 * transaction row lock is taken only inside the short prepare and apply
 * transactions, never across the acquirer call. An approved capture that
 * can no longer be journaled is left for reconciliation; it is not voided.
 */
export async function captureTransaction(
  pool: Pool,
  acquirer: AcquirerSimulator,
  input: CaptureInput,
): Promise<CaptureResult> {
  const prepared = await prepareCapture(pool, input);
  if (prepared.kind === "done") return prepared.result;

  let acquirerResult: AcquirerCaptureResult;
  try {
    acquirerResult = await singleFlight(`capture:${prepared.claimId}`, () =>
      acquirer.capture({
        acquirerReference: prepared.acquirerReference,
        amountFils: prepared.requestedAmount,
        idempotencyKey: prepared.claimId,
      }),
    );
  } catch (err) {
    // The claim stays in_progress. Do not void and do not open a new capture.
    throw err;
  }

  return applyCapture(pool, input, prepared, acquirerResult);
}

async function prepareCapture(pool: Pool, input: CaptureInput): Promise<PreparedCapture> {
  const requestHash = hashRequest({ transactionId: input.transactionId, amountFils: input.amountFils ?? null });

  return withTransaction(pool, async (client) => {
    const claim = await claimIdempotencyKey(client, {
      merchantId: input.merchantId,
      endpoint: ENDPOINT,
      key: input.idempotencyKey,
      requestHash,
    });

    if (claim.outcome === "conflict_hash_mismatch") {
      throw new UnprocessableEntityError("idempotency_key_reused");
    }
    if (claim.row.resourceId !== null && claim.row.resourceId !== input.transactionId) {
      throw new UnprocessableEntityError("idempotency_key_reused");
    }
    if (claim.outcome === "replay") {
      return { kind: "done", result: { statusCode: claim.row.responseStatusCode ?? 200, body: claim.row.responseBody } };
    }

    const recovering = claim.outcome === "conflict_in_progress";
    const lockResult = await client.query<LockedTransactionRow>(
      `SELECT id, merchant_id, status, amount_fils, captured_fils, refunded_fils, acquirer_reference
         FROM transactions
        WHERE id = $1 AND merchant_id = $2
        FOR UPDATE`,
      [input.transactionId, input.merchantId],
    );
    const txn = lockResult.rows[0];
    if (!txn) {
      const body = { error: "transaction_not_found" };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 404, body, resourceId: input.transactionId });
      return { kind: "done", result: { statusCode: 404, body } };
    }

    const other = await client.query(
      `SELECT id FROM idempotency_keys
        WHERE endpoint = $1 AND resource_id = $2 AND status = 'in_progress' AND id <> $3
        LIMIT 1`,
      [ENDPOINT, txn.id, claim.row.id],
    );
    if (other.rows[0]) {
      throw new ConflictError("request_in_progress");
    }

    const capturable = txn.status === "authorized" || txn.status === "partially_captured";
    if (!capturable && !recovering) {
      const body = { error: "not_capturable", status: txn.status };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 409, body, resourceId: txn.id });
      return { kind: "done", result: { statusCode: 409, body } };
    }

    const amountAuthorized = toFils(Number(txn.amount_fils));
    const capturedSoFar = toFils(Number(txn.captured_fils));
    const remaining = subtractFils(amountAuthorized, capturedSoFar);
    const requestedAmount = input.amountFils ?? remaining;
    const amountFits = compareFils(requestedAmount, ZERO_FILS) > 0 && compareFils(requestedAmount, remaining) <= 0;
    if (!amountFits && !recovering) {
      const body = { error: "capture_exceeds_remaining", remainingFils: remaining };
      await completeIdempotencyKey(client, claim.row.id, { statusCode: 422, body, resourceId: txn.id });
      return { kind: "done", result: { statusCode: 422, body } };
    }

    if (!recovering) {
      // Serialize with hold updates and use database time, not an application clock.
      // A recovery of an in-progress claim skips this: the hold may have expired
      // while the acquirer call was outstanding, and that retry must still apply.
      const hold = await client.query(
        `SELECT id FROM holds
          WHERE transaction_id = $1 AND status = 'active' AND expires_at > now()
          FOR UPDATE`,
        [txn.id],
      );
      if (!hold.rows[0]) {
        const body = { error: "authorization_hold_expired" };
        await completeIdempotencyKey(client, claim.row.id, { statusCode: 409, body, resourceId: txn.id });
        return { kind: "done", result: { statusCode: 409, body } };
      }
    }

    await client.query(`UPDATE idempotency_keys SET resource_id = $2 WHERE id = $1`, [claim.row.id, txn.id]);
    return {
      kind: "proceed",
      claimId: claim.row.id,
      recovering,
      acquirerReference: txn.acquirer_reference,
      requestedAmount,
      transactionId: txn.id,
    };
  });
}

async function applyCapture(
  pool: Pool,
  input: CaptureInput,
  prepared: Extract<PreparedCapture, { kind: "proceed" }>,
  acquirerResult: AcquirerCaptureResult,
): Promise<CaptureResult> {
  return withTransaction(pool, async (client) => {
    const lockResult = await client.query<LockedTransactionRow>(
      `SELECT id, merchant_id, status, amount_fils, captured_fils, refunded_fils, acquirer_reference
         FROM transactions
        WHERE id = $1 AND merchant_id = $2
        FOR UPDATE`,
      [prepared.transactionId, input.merchantId],
    );
    const stateResult = await client.query<IdempotencyStateRow>(
      `SELECT status, response_status_code, response_body FROM idempotency_keys WHERE id = $1 FOR UPDATE`,
      [prepared.claimId],
    );
    const state = stateResult.rows[0];
    if (!state) {
      throw new Error("captureTransaction: idempotency claim disappeared before apply");
    }
    if (state.status === "completed") {
      return { statusCode: state.response_status_code ?? 200, body: state.response_body };
    }
    if (state.status === "failed") {
      return { statusCode: state.response_status_code ?? 502, body: state.response_body };
    }

    const txn = lockResult.rows[0];
    if (!txn) {
      throw new Error("captureTransaction: transaction disappeared before apply");
    }

    if (acquirerResult.outcome === "declined") {
      const body = { error: "card_captured_declined" };
      await completeIdempotencyKey(client, prepared.claimId, { statusCode: 402, body, resourceId: txn.id });
      return { statusCode: 402, body };
    }
    if (acquirerResult.outcome === "error") {
      const body = { error: "acquirer_unavailable" };
      await failIdempotencyKey(client, prepared.claimId, { statusCode: 502, body });
      return { statusCode: 502, body };
    }

    const amountAuthorized = toFils(Number(txn.amount_fils));
    const capturedSoFar = toFils(Number(txn.captured_fils));
    const remaining = subtractFils(amountAuthorized, capturedSoFar);
    const requestedAmount = prepared.requestedAmount;
    const capturable = txn.status === "authorized" || txn.status === "partially_captured";
    const amountFits = compareFils(requestedAmount, ZERO_FILS) > 0 && compareFils(requestedAmount, remaining) <= 0;
    if (!capturable || !amountFits) {
      // The external capture succeeded. Do not void it; refund or reconcile.
      const body = { error: "capture_requires_reconciliation", transactionId: txn.id };
      await completeIdempotencyKey(client, prepared.claimId, { statusCode: 409, body, resourceId: txn.id });
      return { statusCode: 409, body };
    }

    const merchantResult = await client.query<{ mdr_bps: number; negotiated_discount_bps: number }>(
      `SELECT mdr_bps, negotiated_discount_bps FROM merchants WHERE id = $1`,
      [input.merchantId],
    );
    const merchant = merchantResult.rows[0];
    if (!merchant) {
      throw new Error("captureTransaction: merchant row disappeared mid-transaction");
    }

    const effectiveMdrBps = await getEffectiveMdrBps(client, input.merchantId, new Date(), merchant.mdr_bps);
    const volumeTierBonusBps = await getVolumeTierBonusBps(client);
    const rateBps = Math.max(0, effectiveMdrBps - volumeTierBonusBps);
    const feeFils = calculateDiscountedMdrFee(requestedAmount, rateBps, merchant.negotiated_discount_bps);
    const newCapturedFils = addFils(capturedSoFar, requestedAmount);
    const fullyCaptured = compareFils(newCapturedFils, amountAuthorized) === 0;
    const newStatus = nextStatusAfterRefund({
      amountFils: amountAuthorized,
      capturedFils: newCapturedFils,
      refundedTotalFils: toFils(Number(txn.refunded_fils)),
    });

    const updateResult = await client.query<TransactionRow>(
      `UPDATE transactions SET status = $2, captured_fils = $3 WHERE id = $1 RETURNING *`,
      [txn.id, newStatus, newCapturedFils],
    );
    const updatedTxn = updateResult.rows[0];
    if (!updatedTxn) {
      throw new Error("captureTransaction: update to transactions returned no row");
    }

    const entryGroupId = randomUUID();
    await client.query(
      `INSERT INTO ledger_entries
         (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
       VALUES
         ($1, $2, $3, 'card_scheme_clearing', 'debit',  $4, now(), 'capture: gross'),
         ($1, $2, $3, 'merchant_payable',     'credit', $4, now(), 'capture: gross')`,
      [entryGroupId, input.merchantId, txn.id, requestedAmount],
    );
    if (feeFils > 0) {
      await client.query(
        `INSERT INTO ledger_entries
           (entry_group_id, merchant_id, transaction_id, account_id, direction, amount_fils, occurred_at, description)
         VALUES
           ($1, $2, $3, 'merchant_payable',     'debit',  $4, now(), 'capture: MDR fee'),
           ($1, $2, $3, 'platform_fee_revenue', 'credit', $4, now(), 'capture: MDR fee')`,
        [entryGroupId, input.merchantId, txn.id, feeFils],
      );
    }

    if (fullyCaptured) {
      await client.query(`UPDATE holds SET status = 'released' WHERE transaction_id = $1 AND status = 'active'`, [
        txn.id,
      ]);
    }

    await enqueueEvent(client, {
      eventType: "transaction.captured",
      aggregateType: "transaction",
      aggregateId: txn.id,
      payload: {
        merchantId: input.merchantId,
        amountCapturedFils: requestedAmount,
        feeFils,
        newStatus,
        capturedTotalFils: newCapturedFils,
      },
    });

    await recordTransactionEvent(client, {
      transactionId: txn.id,
      eventType: fullyCaptured ? "captured" : "partially_captured",
      amountFils: requestedAmount,
      actor: input.actor,
      metadata: { feeFils, acquirerReference: acquirerResult.acquirerReference, feeModel: "discounted_amount" },
    });

    const body = serializeTransaction(updatedTxn);
    await completeIdempotencyKey(client, prepared.claimId, { statusCode: 200, body, resourceId: txn.id });
    return { statusCode: 200, body };
  });
}
