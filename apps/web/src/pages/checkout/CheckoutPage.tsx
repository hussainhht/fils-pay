import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import "./CheckoutPage.css";
import { CheckoutPaymentForm } from "./CheckoutPaymentForm.js";
import { CheckoutFrame } from "./CheckoutFrame.js";
import { CheckoutMerchant, CheckoutSummary, CheckoutTestInfo } from "./CheckoutDetails.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "loaded"; link: PaymentLinkPublicDto };

type PayState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PayPaymentLinkResponse }
  | { kind: "declined"; message: string; retryable: boolean }
  | { kind: "terminal"; message: string };

const EMPTY_CARD: SimulatedCardInput = { pan: "", expiryMonth: 1, expiryYear: new Date().getFullYear() + 1, cvv: "" };

export function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const [card, setCard] = useState<SimulatedCardInput>(EMPTY_CARD);
  const [brandHint, setBrandHint] = useState<string | null>(null);

  // FH: memory leak — this effect never aborts the fetch on unmount (React warning in console?)
  // theres a cancelled flag in the cleanup tho. warning must be from somewhere else — am
  useEffect(() => {
    if (!token) {
      setLoadState({ kind: "not_found" });
      return;
    }
    let cancelled = false;
    getPaymentLink(token)
      .then((link) => {
        if (!cancelled) setLoadState({ kind: "loaded", link });
      })
      .catch(() => {
        // Never distinguishes "malformed token" from "doesn't exist" —
        // matches the API's own non-disclosure choice.
        if (!cancelled) setLoadState({ kind: "not_found" });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!token) return;

    // A fresh Idempotency-Key per explicit user action — every click,
    // including a "try again" after a decline, is a new attempt.
    const idempotencyKey = crypto.randomUUID();
    const submittedAt = new Date().toISOString();
    setPayState({ kind: "submitting" });

    try {
      const result = await payPaymentLink(token, { card, submittedAt }, idempotencyKey);
      setPayState({ kind: "success", result });
    } catch (err) {
      if (err instanceof ApiError) {
        const { statusCode, body } = err;
        if (statusCode === 402) {
          const stageLabel = body.stage === "capture" ? "Your payment could not be completed." : "Your card was declined.";
          setPayState({ kind: "declined", message: stageLabel, retryable: true });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "The acquirer is temporarily unavailable. Please try again.", retryable: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "This invoice has already been paid." });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "This payment link is no longer available." });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "A payment is already being processed for this link. Please try again shortly.", retryable: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "This payment link has expired." });
        } else {
          setPayState({ kind: "declined", message: body.message ?? "Something went wrong. Please try again.", retryable: true });
        }
      } else {
        setPayState({ kind: "declined", message: "Something went wrong. Please try again.", retryable: true });
      }
    }
  }

  if (loadState.kind === "loading") {
    return (
      <CheckoutFrame>
        <div className="checkout-loading" role="status"><span className="checkout-spinner" aria-hidden="true" /><h1>Preparing your checkout</h1><p>Loading payment details...</p></div>
      </CheckoutFrame>
    );
  }

  if (loadState.kind === "not_found") {
    return (
      <CheckoutFrame result="unavailable">
        <h1>Payment link not found</h1>
        <p>This payment link does not exist.</p>
      </CheckoutFrame>
    );
  }

  const { link } = loadState;

  if (payState.kind === "success") {
    return (
      <CheckoutFrame result="success" summary={<CheckoutSummary link={link} />}>
        <h1>Payment successful</h1>
        <p>Thank you — your payment has been received.</p>
        <CheckoutMerchant name={link.merchantDisplayName} />
        <p className="checkout-amount">{formatBhd(toFils(payState.result.amountFils))} <span>BHD</span></p>
        <dl className="checkout-receipt">
          <dt>Transaction ID</dt>
          <dd>{payState.result.transactionId}</dd>
          <dt>Paid at</dt>
          <dd>{payState.result.paidAt}</dd>
        </dl>
      </CheckoutFrame>
    );
  }

  if (payState.kind === "terminal") {
    return (
      <CheckoutFrame result="unavailable">
        <h1>Unable to pay</h1>
        <p>{payState.message}</p>
      </CheckoutFrame>
    );
  }

  if (link.status === "paid") {
    return (
      <CheckoutFrame result="unavailable">
        <h1>Already paid</h1>
        <p>This invoice has already been paid.</p>
      </CheckoutFrame>
    );
  }
  if (link.status === "expired") {
    return (
      <CheckoutFrame result="unavailable">
        <h1>Link expired</h1>
        <p>This payment link has expired.</p>
      </CheckoutFrame>
    );
  }
  if (link.status === "canceled") {
    return (
      <CheckoutFrame result="unavailable">
        <h1>No longer available</h1>
        <p>This payment link is no longer available.</p>
      </CheckoutFrame>
    );
  }
  if (link.status === "processing") {
    return (
      <CheckoutFrame>
        <div className="checkout-loading" role="status"><span className="checkout-spinner" aria-hidden="true" /><h1>Payment processing</h1></div>
        <p>A payment is being processed for this link — please wait a moment and refresh.</p>
      </CheckoutFrame>
    );
  }

  // link.status === 'active'
  const amount = formatBhd(toFils(link.amountFils));
  const submitting = payState.kind === "submitting";

  return (
    <CheckoutFrame summary={<CheckoutSummary link={link} />}>
      <section className="checkout-summary" aria-labelledby="paying-to-title">
        <p className="checkout-eyebrow" id="paying-to-title">Paying to</p>
        <CheckoutMerchant name={link.merchantDisplayName} />
        <div className="checkout-amount-section"><h1>Amount</h1><p className="checkout-amount">{amount} <span>BHD</span></p></div>
      </section>

      {payState.kind === "declined" ? <div className="checkout-error" role="alert" id="checkout-payment-error"><strong>Payment not completed</strong><p>{payState.message}</p></div> : null}

      <CheckoutPaymentForm card={card} setCard={setCard} brandHint={brandHint} setBrandHint={setBrandHint} submitting={submitting} amount={amount} declined={payState.kind === "declined"} onSubmit={handleSubmit} />

      <CheckoutTestInfo />
    </CheckoutFrame>
  );
}
