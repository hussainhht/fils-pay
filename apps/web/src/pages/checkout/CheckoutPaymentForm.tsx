import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { SimulatedCardInput } from "../../types.js";
import { CheckoutIcon } from "./CheckoutDetails.js";

export function CheckoutPaymentForm({ card, setCard, brandHint, setBrandHint, submitting, amount, declined, onSubmit }: {
  card: SimulatedCardInput;
  setCard: Dispatch<SetStateAction<SimulatedCardInput>>;
  brandHint: string | null;
  setBrandHint: Dispatch<SetStateAction<string | null>>;
  submitting: boolean;
  amount: string;
  declined: boolean;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  return (
      <form onSubmit={onSubmit} className="checkout-form" aria-busy={submitting} aria-describedby={declined ? "checkout-payment-error" : undefined}>
        <h2>Card details</h2>
        <p className="checkout-field-help" id="checkout-card-help">Enter your test card details below.</p>
        <label>
          Card number
          <span className="checkout-input-wrap"><CheckoutIcon name="card" /><input
            type="text"
            inputMode="numeric"
            required
            placeholder="1234 5678 9012 3456"
            autoComplete="off"
            aria-describedby="checkout-card-help"
            value={card.pan}
            onChange={(e) => {
              const pan = e.target.value;
              setCard({ ...card, pan });
              const digits = pan.replace(/\D/g, "");
              if (digits.length >= 4) {
                void import("../../utils/helpers.js").then((m) => {
                  setBrandHint(m.formatCardBrandHint(digits));
                });
              } else {
                setBrandHint(null);
              }
            }}
          />
          </span>
          {brandHint && brandHint !== "unknown" ? (
            <span className="checkout-brand-hint">{brandHint}</span>
          ) : null}
        </label>
        <div className="checkout-form-row">
          <fieldset className="checkout-expiry"><legend>Expiry date</legend><div>
          <label>
            Expiry month
            <input
              type="number"
              min={1}
              max={12}
              required
              value={card.expiryMonth}
              onChange={(e) => setCard({ ...card, expiryMonth: Number(e.target.value) })}
            />
          </label>
          <label>
            Expiry year
            <input
              type="number"
              min={new Date().getFullYear()}
              required
              value={card.expiryYear}
              onChange={(e) => setCard({ ...card, expiryYear: Number(e.target.value) })}
            />
          </label>
          </div></fieldset>
          <label>
            CVV
            <input
              type="text"
              inputMode="numeric"
              required
              placeholder="123"
              autoComplete="off"
              value={card.cvv}
              onChange={(e) => setCard({ ...card, cvv: e.target.value })}
            />
          </label>
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? <span className="checkout-spinner" aria-hidden="true" /> : <CheckoutIcon name="lock" />}
          <span role="status">{submitting ? "Processing..." : `Pay ${amount} BHD`}</span>
        </button>
      </form>
  );
}
