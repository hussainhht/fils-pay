import type { Pool } from "pg";
import type { Fils } from "@filspay/money";
import { withTransaction } from "../db/withTransaction.js";
import type { AcquirerAuthorizeResult, AcquirerSimulator, SimulatedCardInput } from "../acquirer/types.js";
import { claimIdempotencyKey, completeIdempotencyKey, failIdempotencyKey, hashRequest, singleFlight } from "./idempotency.js";
import { recordTransactionEvent } from "../transactions/events.js";
import { serializeTransaction, type TransactionRow } from "../transactions/serialize.js";
import { UnprocessableEntityError } from "../lib/errors.js";

// YA: part of the idempotency scope, never rename it
const ENDPOINT = "transactions.authorize";

export interface AuthorizeInput {
  merchantId: string;
  amountFils: Fils;
  card: SimulatedCardInput;
  reference?: string;
  idempotencyKey: string;
  /** Who is performing this authorization, for the transaction_events
   *  audit trail. Optional because the hosted-checkout payment-link flow
   *  has no merchant session or API key of its own; defaults to a 'system'
   *  actor when omitted. POST /v1/transactions always supplies the calling
   *  API key here. */
  actor?: { type: "merchant_session" | "merchant_api_key" | "system"; id?: string | null };
}

/**
 * 201 + serialized transaction on approval; 402 on decline (replays as
 * 402); 403 when the merchant is not approved; 502 on acquirer error, in
 * which case the same key may be retried.
 */
export interface AuthorizeResult {
  statusCode: number;
  body: unknown;
}

interface IdempotencyStateRow {
  status: "in_progress" | "completed" | "failed";
  response_status_code: number | null;
  response_body: unknown;
}

/**
 * `POST /v1/transactions` business logic. The idempotency claim commits
 * before the acquirer call, and the apply transaction writes the row only
 * after the acquirer returns. A decline or acquirer error never produces a
 * `transactions` row (the status CHECK has no 'declined' value) — the only
 * durable trace of such an attempt is its idempotency_keys row.
 */
export async function authorizeTransaction(
  pool: Pool,
  acquirer: AcquirerSimulator,
  input: AuthorizeInput,
): Promise<AuthorizeResult> {
  const actor = input.actor ?? { type: "system" as const, id: null };
  const requestHash = hashRequest({
    amountFils: input.amountFils,
    card: input.card,
    reference: input.reference ?? null,
  });

  const prepared = await withTransaction(pool, async (client) => {
    const claim = await claimIdempotencyKey(client, {
      merchantId: input.merchantId,
      endpoint: ENDPOINT,
      key: input.idempotencyKey,
      requestHash,
    });

    if (claim.outcome === "conflict_hash_mismatch") {
      throw new UnprocessableEntityError("idempotency_key_reused");
    }
    if (claim.outcome === "replay") {
      return { kind: "done" as const, result: { statusCode: claim.row.responseStatusCode ?? 200, body: claim.row.responseBody } };
    }
    if (claim.outcome !== "conflict_in_progress") {
      const merchantResult = await client.query<{ onboarding_status: string; status: string; mdr_bps: number }>(
        `SELECT onboarding_status, status, mdr_bps FROM merchants WHERE id = $1`,
        [input.merchantId],
      );
      const merchant = merchantResult.rows[0];
      // FH: should test_mode merchants be blocked here? Claude said yes and gave this:
      //   if (merchant.test_mode) {
      //     return { statusCode: 403, body: { error: "test_mode_merchant" } };
      //   }
      // am: NO. test mode merchants have to authorize, thats the whole point of sandbox. ignore
      if (!merchant || merchant.onboarding_status !== "approved" || merchant.status !== "active") {
        const body = { error: "merchant_not_approved" };
        await completeIdempotencyKey(client, claim.row.id, { statusCode: 403, body });
        return { kind: "done" as const, result: { statusCode: 403, body } };
      }
    }
    return { kind: "proceed" as const, claimId: claim.row.id, attemptCount: claim.row.attemptCount };
  });

  if (prepared.kind === "done") return prepared.result;

  const acquirerResult = await singleFlight(`authorize:${prepared.claimId}:${prepared.attemptCount}`, () =>
    acquirer.authorize({
      merchantId: input.merchantId,
      amountFils: input.amountFils,
      currency: "BHD",
      card: input.card,
      idempotencyKey: `${prepared.claimId}:${prepared.attemptCount}`,
    }),
  );

  return applyAuthorization(pool, input, actor, prepared.claimId, acquirerResult);
}

async function applyAuthorization(
  pool: Pool,
  input: AuthorizeInput,
  actor: { type: "merchant_session" | "merchant_api_key" | "system"; id?: string | null },
  claimId: string,
  acquirerResult: AcquirerAuthorizeResult,
): Promise<AuthorizeResult> {
  return withTransaction(pool, async (client) => {
    const stateResult = await client.query<IdempotencyStateRow>(
      `SELECT status, response_status_code, response_body FROM idempotency_keys WHERE id = $1 FOR UPDATE`,
      [claimId],
    );
    const state = stateResult.rows[0];
    if (!state) {
      throw new Error("authorizeTransaction: idempotency claim disappeared before apply");
    }
    if (state.status === "completed") {
      return { statusCode: state.response_status_code ?? 200, body: state.response_body };
    }
    if (state.status === "failed") {
      return { statusCode: state.response_status_code ?? 502, body: state.response_body };
    }

    if (acquirerResult.outcome === "approved") {
      const insertResult = await client.query<TransactionRow>(
        `INSERT INTO transactions (merchant_id, status, amount_fils, captured_fils, acquirer_reference, reference)
         VALUES ($1, 'authorized', $2, 0, $3, $4)
         RETURNING *`,
        [input.merchantId, input.amountFils, acquirerResult.acquirerReference, input.reference ?? null],
      );
      const txnRow = insertResult.rows[0];
      if (!txnRow) {
        throw new Error("authorizeTransaction: insert into transactions returned no row");
      }

      // MK: 7 days = scheme rule for CNP. expire_holds.ts only flips status to expired,
      // it never deletes, so the hold history stays
      await client.query(
        `INSERT INTO holds (merchant_id, transaction_id, amount_fils, status, expires_at)
         VALUES ($1, $2, $3, 'active', now() + interval '7 days')`,
        [input.merchantId, txnRow.id, input.amountFils],
      );

      await recordTransactionEvent(client, {
        transactionId: txnRow.id,
        eventType: "authorized",
        actor,
      });

      const body = serializeTransaction(txnRow);
      await completeIdempotencyKey(client, claimId, { statusCode: 201, body, resourceId: txnRow.id });
      return { statusCode: 201, body };
    }

    if (acquirerResult.outcome === "declined") {
      const body = {
        error: "card_declined",
        declineReason: acquirerResult.declineReason,
        acquirerReference: acquirerResult.acquirerReference,
      };
      await completeIdempotencyKey(client, claimId, { statusCode: 402, body });
      return { statusCode: 402, body };
    }

    const body = { error: "acquirer_unavailable" };
    await failIdempotencyKey(client, claimId, { statusCode: 502, body });
    return { statusCode: 502, body };
  });
}
