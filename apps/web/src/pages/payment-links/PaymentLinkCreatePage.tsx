import { PageHeading } from "../../../../ui/PageHeading.js";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPaymentLink } from "../../api/paymentLinks.js";
import { ApiError, describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { BhdAmountInput } from "./BhdAmountInput.js";
import { normalizeBhdAmount, parseBhdAmountDraft } from "./bhdAmount.js";
import { ExpirationInput } from "./ExpirationInput.js";
import { resolveExpiration, type ExpirationOption } from "./expiration.js";

/**
 * `POST /v1/merchants/:merchantId/payment-links`, `owner`/`finance`
 * server-side.
 *
 * Amount is edited as BHD text and converted by @filspay/money to exact
 * integer fils at submission. Formatting is deferred until blur/submit.
 *
 * The two client-side checks below mirror the server's own two real checks so
 * an obviously-bad value doesn't need a round trip. They are not the
 * validation: the server remains authoritative. Expiration rejections are
 * shown beside the controls with guidance to choose another date/time.
 */
export function PaymentLinkCreatePage() {
  const { me } = useDashboardAuth();
  const navigate = useNavigate();

  const [amountBhd, setAmountBhd] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [expirationOption, setExpirationOption] = useState<ExpirationOption>("24-hours");
  const [expirationDate, setExpirationDate] = useState("");
  const [expirationTime, setExpirationTime] = useState("");
  const [now, setNow] = useState(Date.now);
  const expiration = resolveExpiration(expirationOption, expirationDate, expirationTime, now);
  const [expirationError, setExpirationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);

  function updateExpiration(change: () => void) {
    change();
    setNow(Date.now());
    setExpirationError(null);
  }

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!me) return;
    setError(null);

    const amount = parseBhdAmountDraft(amountBhd);
    if (amount === null || amount <= 0) {
      setError("Enter a positive BHD amount with up to 3 decimal places, within the supported range.");
      return;
    }
    setAmountBhd(normalizeBhdAmount(amountBhd));
    // Revalidate on submission: a custom selection can age while the form is open.
    const submittedAt = Date.now();
    setNow(submittedAt);
    const selectedExpiration = resolveExpiration(expirationOption, expirationDate, expirationTime, submittedAt).value;
    if (!selectedExpiration) return;

    setExpirationError(null);
    setSubmitting(true);
    try {
      const link = await createPaymentLink(me.merchant.id, {
        amountFils: amount,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        ...selectedExpiration,
      });
      navigate(`/dashboard/payment-links/${link.id}`, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "invalid_expiry") {
        setExpirationError("Choose an expiration between 15 minutes and 120 days from now, then try again.");
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <PageHeading title="New payment link" />

      {error ? <p className="dash-error">{error}</p> : null}

      <form className="dash-form" onSubmit={(e) => void handleSubmit(e)}>
        <label htmlFor="payment-link-amount">
          Amount in BHD
          <BhdAmountInput value={amountBhd} onChange={setAmountBhd} />
        </label>
        <p id="payment-link-amount-hint" className="dash-muted dash-hint">Up to 3 decimal places. 1.000 BHD = 1,000 fils.</p>
        <label>
          Reference (optional)
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label>
          Description (optional)
          <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <ExpirationInput option={expirationOption} date={expirationDate} time={expirationTime} now={now}
          resolution={expiration} serverError={expirationError}
          onOption={(value) => updateExpiration(() => setExpirationOption(value))}
          onDate={(value) => updateExpiration(() => setExpirationDate(value))}
          onTime={(value) => updateExpiration(() => setExpirationTime(value))} />
        <button type="submit" className="dash-button" disabled={submitting || expiration.value === null}>
          {submitting ? "Creating..." : "Create payment link"}
        </button>
      </form>

      <p>
        <Link to="/dashboard/payment-links">Back to payment links</Link>
      </p>
    </section>
  );
}
