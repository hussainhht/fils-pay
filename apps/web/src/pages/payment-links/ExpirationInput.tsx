import { useState } from "react";
import { EXPIRATION_OPTIONS, expirationLimits, expirationPreview, type ExpirationOption, type resolveExpiration } from "./expiration.js";
import "./ExpirationInput.css";

export function ExpirationInput({ option, date, time, now, resolution, serverError, onOption, onDate, onTime }: {
  option: ExpirationOption;
  date: string;
  time: string;
  now: number;
  resolution: ReturnType<typeof resolveExpiration>;
  serverError: string | null;
  onOption: (value: ExpirationOption) => void;
  onDate: (value: string) => void;
  onTime: (value: string) => void;
}) {
  const [dateTouched, setDateTouched] = useState(false);
  const [timeTouched, setTimeTouched] = useState(false);
  const limits = expirationLimits(now);
  const dateError = date || dateTouched ? resolution.dateError : null;
  const timeError = time || timeTouched ? resolution.timeError : null;
  const timeMessage = timeError ?? serverError;

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
      <p id="payment-link-expiration-hint" className="payment-link-expiration-note">
        15 minutes to 120 days. Bahrain time (UTC+03:00).
      </p>
      {option === "custom" ? (
        <div className="payment-link-custom-expiration">
          <div className="payment-link-expiration-field">
            <label htmlFor="payment-link-expiration-date">Expiration date</label>
            <input id="payment-link-expiration-date" type="date" required min={limits.min.date} max={limits.max.date}
              value={date} onChange={(event) => onDate(event.target.value)} onBlur={() => setDateTouched(true)}
              aria-invalid={Boolean(dateError)} aria-describedby={dateError ? "payment-link-expiration-date-error" : "payment-link-expiration-hint"} />
            {dateError ? <p id="payment-link-expiration-date-error" className="payment-link-expiration-error" role="alert">{dateError}</p> : null}
          </div>
          <div className="payment-link-expiration-field">
            <label htmlFor="payment-link-expiration-time">Expiration time</label>
            <input id="payment-link-expiration-time" type="time" required step={60}
              min={date === limits.min.date ? limits.min.time : undefined}
              max={date === limits.max.date ? limits.max.time : undefined}
              value={time} onChange={(event) => onTime(event.target.value)} onBlur={() => setTimeTouched(true)}
              aria-invalid={Boolean(timeMessage)} aria-describedby={timeMessage ? "payment-link-expiration-time-error" : "payment-link-expiration-hint"} />
            {timeMessage ? <p id="payment-link-expiration-time-error" className="payment-link-expiration-error" role="alert">{timeMessage}</p> : null}
          </div>
        </div>
      ) : null}
      {option !== "custom" && serverError ? <p className="payment-link-expiration-error" role="alert">{serverError}</p> : null}
      <div className="payment-link-expiration-preview" aria-live="polite" aria-atomic="true" data-expiration-preview>
        <p className="payment-link-expiration-preview-label">{option === "custom" ? "Expires on" : "Estimated expiration"}</p>
        <p className="payment-link-expiration-preview-value">
          {resolution.value ? expirationPreview(resolution.value, now) : "Choose a valid date and time to see your expiration."}
        </p>
        <p className="payment-link-expiration-note">
          {option === "custom" ? "The server confirms and saves this expiration when you create the link."
            : "Starts when you create the link. The server calculates and saves the expiration."}
        </p>
      </div>
    </fieldset>
  );
}
