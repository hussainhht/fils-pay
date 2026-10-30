import { useEffect, useState } from "react";
import { EXPIRATION_OPTIONS, expirationPreview, type DurationUnit, type ExpirationOption } from "./expiration.js";
import "./ExpirationInput.css";

export function ExpirationInput({ option, custom, unit, seconds, onOption, onCustom, onUnit }: {
  option: ExpirationOption;
  custom: string;
  unit: DurationUnit;
  seconds: number | null;
  onOption: (value: ExpirationOption) => void;
  onCustom: (value: string) => void;
  onUnit: (value: DurationUnit) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [option, custom, unit]);

  return (
    <fieldset className="payment-link-expiration" aria-describedby="payment-link-expiration-hint">
      <legend>Link expiration</legend>
      <div className="payment-link-expiration-options">
        {EXPIRATION_OPTIONS.map((entry) => (
          <label key={entry.value} className="payment-link-expiration-option">
            <input type="radio" name="expiration" value={entry.value} checked={option === entry.value}
              onChange={() => onOption(entry.value)} />
            <span>{entry.label}</span>
          </label>
        ))}
      </div>
      {option === "custom" ? (
        <div className="payment-link-custom-duration">
          <label htmlFor="payment-link-duration">Duration
            <input id="payment-link-duration" type="text" inputMode="numeric" pattern="[0-9]+" required
              value={custom} onChange={(event) => onCustom(event.target.value)}
              aria-invalid={seconds === null} aria-describedby="payment-link-expiration-hint" />
          </label>
          <label htmlFor="payment-link-duration-unit">Duration unit
            <select id="payment-link-duration-unit" value={unit} onChange={(event) => onUnit(event.target.value as DurationUnit)}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </label>
        </div>
      ) : null}
      <p id="payment-link-expiration-hint" className="dash-muted dash-hint">
        Choose 15 minutes to 120 days, inclusive. Use a whole number for custom duration. One day is 24 hours.
      </p>
      <p className="dash-hint" aria-live="polite" data-expiration-preview>
        {seconds === null ? "Enter a valid duration to preview expiration." : `Estimated expiration (Asia/Bahrain, UTC+03:00): ${expirationPreview(seconds, now)}.`}
        {" "}Duration starts when the server creates the link; the saved expiration is authoritative.
      </p>
    </fieldset>
  );
}
