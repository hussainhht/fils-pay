import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { formatBhd, toFils } from "@filspay/money";
import { getPaymentLink, payPaymentLink } from "../../api/paymentLinks.js";
import { ApiError } from "../../api/client.js";
import type { PaymentLinkPublicDto, PayPaymentLinkResponse, SimulatedCardInput } from "../../types.js";
import "./CheckoutPage.css";
import { CheckoutFrame } from "./CheckoutFrame.js";
import { CardPaymentForm } from "./CardPaymentForm.js";
import { linkHasExpired } from "./cardInput.js";
import { CheckoutMerchant, CheckoutSummary, CheckoutTestInfo } from "./CheckoutDetails.js";

type LoadState =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "loaded"; link: PaymentLinkPublicDto };

type PayState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; result: PayPaymentLinkResponse }
  | { kind: "declined"; message: string; recovery?: boolean }
  | { kind: "terminal"; message: string };

export function CheckoutPage() {
  const { token } = useParams<{ token: string }>();
  return <CheckoutSession key={token} token={token} />;
}

function CheckoutSession({ token }: { token: string | undefined }) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [payState, setPayState] = useState<PayState>({ kind: "idle" });
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const attemptKey = useRef<string | null>(null);

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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function handleSubmit(card: SimulatedCardInput): Promise<void> {
    if (!token || inFlight.current || loadState.kind !== "loaded") return;
    // A bound attempt may resume after expiry; only the server can determine
    // its outcome. A new attempt must never begin after the deadline.
    if (!attemptKey.current && (loadState.link.status !== "active" || linkHasExpired(loadState.link.expiresAt))) {
      setPayState({ kind: "terminal", message: "This payment link has expired or is no longer available." });
      return;
    }
    inFlight.current = true;
    const idempotencyKey = attemptKey.current ?? crypto.randomUUID();
    attemptKey.current = idempotencyKey;
    setPayState({ kind: "submitting" });

    try {
      const result = await payPaymentLink(token, { card }, idempotencyKey);
      setPayState({ kind: "success", result });
    } catch (err) {
      if (err instanceof ApiError) {
        const { statusCode, body } = err;
        if (statusCode === 402) {
          attemptKey.current = null;
          const stageLabel = body.stage === "capture" ? "Your payment could not be completed." : "Your card was declined.";
          setPayState({ kind: "declined", message: stageLabel });
        } else if (statusCode === 502) {
          setPayState({ kind: "declined", message: "The payment processor is temporarily unavailable. Your payment outcome is not yet confirmed.", recovery: true });
        } else if (statusCode === 409 && body.error === "payment_link_already_paid") {
          setPayState({ kind: "terminal", message: "This invoice has already been paid." });
        } else if (statusCode === 409 && body.error === "payment_link_canceled") {
          setPayState({ kind: "terminal", message: "This payment link is no longer available." });
        } else if (statusCode === 409) {
          setPayState({ kind: "declined", message: "A payment is already being processed for this link. Please check again shortly.", recovery: true });
        } else if (statusCode === 410) {
          setPayState({ kind: "terminal", message: "This payment link has expired." });
        } else if (statusCode >= 500) {
          setPayState({ kind: "declined", message: "We could not confirm the payment outcome. Please retry this payment.", recovery: true });
        } else {
          setPayState({ kind: "terminal", message: "This payment could not be processed. Please contact the merchant." });
        }
      } else {
        setPayState({ kind: "declined", message: "We could not confirm the payment outcome. Check your connection and retry this payment.", recovery: true });
      }
    } finally {
      inFlight.current = false;
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
  if (link.status === "expired" || (link.status === "active" && !attemptKey.current && linkHasExpired(link.expiresAt, now))) {
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

      <CardPaymentForm amount={amount} submitting={submitting}
        recovery={payState.kind === "declined" && Boolean(payState.recovery)} onPay={handleSubmit} />

      <CheckoutTestInfo />
    </CheckoutFrame>
  );
}
