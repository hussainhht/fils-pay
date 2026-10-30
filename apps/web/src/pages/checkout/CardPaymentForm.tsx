import { useLayoutEffect, useRef, useState } from "react";
import type { InputHTMLAttributes } from "react";
import type { SimulatedCardInput } from "../../types.js";
import { CardBrand } from "./CardBrand.js";
import { cardBrandNames, deleteBesideSeparator, detectCardBrand, digitsOnly, formatCardNumber, formatEdit, formatExpiry, securityCodeLength, toCardInput, validateCard } from "./cardInput.js";
import type { CardFields, FormattedEdit } from "./cardInput.js";

type NumericFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  format: (value: string) => string;
};

function NumericField({ value, onValueChange, format, ...props }: NumericFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const selection = useRef<FormattedEdit | null>(null);
  useLayoutEffect(() => {
    if (selection.current && input.current === document.activeElement) {
      input.current?.setSelectionRange(selection.current.start, selection.current.end);
    }
    selection.current = null;
  }, [value]);
  function apply(edit: FormattedEdit, target: HTMLInputElement) {
    selection.current = edit;
    // Also restore immediately when filtering leaves the React value unchanged.
    target.value = edit.value;
    onValueChange(edit.value);
    target.setSelectionRange(edit.start, edit.end);
  }
  return <input {...props} ref={input} type={props.type ?? "text"} inputMode="numeric" value={value}
    onChange={(event) => {
      const target = event.currentTarget;
      const inputType = (event.nativeEvent as InputEvent).inputType;
      // Some mobile keyboards only emit input events for deletion. A removed
      // separator must still delete a digit rather than immediately reappear.
      if (digitsOnly(target.value) === digitsOnly(value) && target.value.length < value.length) {
        const backward = inputType === "deleteContentBackward";
        if (backward || inputType === "deleteContentForward") {
          const caret = (target.selectionStart ?? 0) + (backward ? 1 : 0);
          const edit = deleteBesideSeparator(value, caret, caret, backward ? "Backspace" : "Delete", format);
          if (edit) { apply(edit, target); return; }
        }
      }
      apply(formatEdit(target.value, target.selectionStart ?? target.value.length, target.selectionEnd ?? target.value.length, format), target);
    }}
    onKeyDown={(event) => {
      if (props.disabled || props.readOnly || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.currentTarget;
      const edit = deleteBesideSeparator(value, target.selectionStart ?? 0, target.selectionEnd ?? 0, event.key, format);
      if (edit) { event.preventDefault(); apply(edit, target); }
    }} />;
}

export function CardPaymentForm({ amount, submitting, recovery, onPay }: {
  amount: string;
  submitting: boolean;
  recovery: boolean;
  onPay: (card: SimulatedCardInput) => Promise<void>;
}) {
  const [fields, setFields] = useState<CardFields>({ number: "", expiry: "", securityCode: "" });
  const [touched, setTouched] = useState<Partial<Record<keyof CardFields, boolean>>>({});
  const form = useRef<HTMLFormElement>(null);
  const busy = useRef(false);
  const brand = detectCardBrand(fields.number);
  const errors = validateCard(fields);
  const locked = submitting || recovery;
  function update(field: keyof CardFields, value: string) { setFields((previous) => ({ ...previous, [field]: value })); }
  function blur(field: keyof CardFields) { setTouched((previous) => ({ ...previous, [field]: true })); }
  function error(field: keyof CardFields) { return touched[field] ? errors[field] : undefined; }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy.current || submitting) return;
    setTouched({ number: true, expiry: true, securityCode: true });
    if (!recovery && Object.keys(errors).length) {
      const first = Object.keys(errors)[0];
      form.current?.querySelector<HTMLInputElement>(`[name="${first}"]`)?.focus();
      return;
    }
    busy.current = true;
    try { await onPay(toCardInput(fields)); } finally { busy.current = false; }
  }

  return (
    <form ref={form} onSubmit={submit} className="checkout-form" noValidate aria-busy={submitting}>
      <h2>Card details</h2>
      <div className="checkout-field">
        <label htmlFor="card-number">Card number</label>
        <div className={`checkout-number-field${fields.number ? " has-number" : ""}`}>
          <NumericField id="card-number" name="number" autoComplete="cc-number" required spellCheck={false}
            placeholder="1234 5678 9012 3456" value={fields.number} format={formatCardNumber}
            onValueChange={(value) => update("number", value)} onBlur={() => blur("number")} readOnly={locked}
            aria-invalid={Boolean(error("number"))} aria-describedby={`card-brand${error("number") ? " card-number-error" : ""}`} />
          <span className="checkout-card-logos" aria-hidden="true">
            {fields.number ? <CardBrand brand={brand} /> : <>{(["visa", "mastercard", "amex"] as const).map((network) => <CardBrand key={network} brand={network} />)}</>}
          </span>
        </div>
        <span id="card-brand" className="checkout-field-hint" aria-live="polite">
          {fields.number ? brand === "unknown" ? "Network not recognized. Check the number; acceptance is determined by the payment processor." : cardBrandNames[brand] : "Visa, Mastercard, American Express and other test cards"}
        </span>
        {error("number") ? <span id="card-number-error" className="checkout-field-error">{error("number")}</span> : null}
      </div>
      <div className="checkout-form-row">
        <div className="checkout-field">
          <label htmlFor="card-expiry">Expiration date</label>
          <NumericField id="card-expiry" name="expiry" autoComplete="cc-exp" required placeholder="MM/YY"
            value={fields.expiry} format={formatExpiry} onValueChange={(value) => update("expiry", value)}
            onBlur={() => blur("expiry")} readOnly={locked} aria-invalid={Boolean(error("expiry"))}
            aria-describedby={error("expiry") ? "card-expiry-error" : undefined} />
          {error("expiry") ? <span id="card-expiry-error" className="checkout-field-error">{error("expiry")}</span> : null}
        </div>
        <div className="checkout-field">
          <label htmlFor="card-cvv">Security code</label>
          <NumericField id="card-cvv" name="securityCode" type="password" autoComplete="cc-csc" required
            placeholder={brand === "amex" ? "4 digits" : "3 digits"} value={fields.securityCode} format={digitsOnly}
            onValueChange={(value) => update("securityCode", value)} onBlur={() => blur("securityCode")} readOnly={locked}
            aria-invalid={Boolean(error("securityCode"))} aria-describedby={`card-cvv-hint${error("securityCode") ? " card-cvv-error" : ""}`} />
          <span id="card-cvv-hint" className="checkout-field-hint">{securityCodeLength(brand)} digits on the {brand === "amex" ? "front" : "back"} of your card</span>
          {error("securityCode") ? <span id="card-cvv-error" className="checkout-field-error">{error("securityCode")}</span> : null}
        </div>
      </div>
      <p className="checkout-field-hint checkout-save-note">Card saving is unavailable for this checkout.</p>
      <button type="submit" disabled={submitting}>{submitting ? "Processing payment…" : recovery ? "Check payment / retry" : `Pay ${amount} BHD`}</button>
      {recovery ? <p className="checkout-field-hint" role="status">Your payment outcome is not yet confirmed. Keep this page open and retry with the same details.</p> : null}
    </form>
  );
}
