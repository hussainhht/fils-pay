import { PageHeading } from "../../../../ui/PageHeading.js";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createPaymentLink } from "../../api/paymentLinks.js";
import { describeError } from "../../api/client.js";
import { useDashboardAuth } from "../../auth/DashboardAuthContext.js";
import { localDateTimeToIso } from "../../format.js";
import { BhdAmountInput } from "./BhdAmountInput.js";
import { normalizeBhdAmount, parseBhdAmountDraft } from "./bhdAmount.js";

/**
 * `POST /v1/merchants/:merchantId/payment-links`, `owner`/`finance`
 * server-side.
 *
 * Amount is edited as BHD text and converted by @filspay/money to exact
 * integer fils at submission. Formatting is deferred until blur/submit.
 *
 * The two client-side checks below mirror the server's own two real checks so
 * an obviously-bad value doesn't need a round trip. They are not the
 * validation: `400 invalid_amount` / `400 invalid_expiry` remain the real
 * answer and are rendered verbatim.
 */
export function PaymentLinkCreatePage() {
  const { me } = useDashboardAuth();
  const navigate = useNavigate();

  const [amountBhd, setAmountBhd] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const expiresAtIso = localDateTimeToIso(expiresAt);
    if (!expiresAtIso) {
      setError("Expiry must be a valid date and time.");
      return;
    }
    if (new Date(expiresAtIso).getTime() <= Date.now()) {
      setError("Expiry must be in the future.");
      return;
    }

    setSubmitting(true);
    try {
      const link = await createPaymentLink(me.merchant.id, {
        amountFils: amount,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
        expiresAt: expiresAtIso,
      });
      navigate(`/dashboard/payment-links/${link.id}`, { replace: true });
    } catch (err) {
      setError(describeError(err));
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
        <label>
          Expires at
          <input
            type="datetime-local"
            required
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </label>
        <button type="submit" className="dash-button" disabled={submitting}>
          {submitting ? "Creating..." : "Create payment link"}
        </button>
      </form>

      <p>
        <Link to="/dashboard/payment-links">Back to payment links</Link>
      </p>
    </section>
  );
}
