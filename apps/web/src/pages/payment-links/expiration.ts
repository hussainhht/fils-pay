export const EXPIRATION_OPTIONS = [
  { value: "15-minutes", label: "15 Minutes", seconds: 900 },
  { value: "24-hours", label: "24 Hours", seconds: 86400 },
  { value: "7-days", label: "7 Days", seconds: 7 * 86400 },
  { value: "30-days", label: "30 Days", seconds: 30 * 86400 },
  { value: "90-days", label: "90 Days", seconds: 90 * 86400 },
  { value: "custom", label: "Custom Expiration", seconds: null },
] as const;

export type ExpirationOption = typeof EXPIRATION_OPTIONS[number]["value"];
export type ExpirationValue = { expiresInSeconds: number; expiresAt?: never } | { expiresAt: string; expiresInSeconds?: never };
export const MIN_EXPIRATION_MS = 15 * 60 * 1000;
export const MAX_EXPIRATION_MS = 120 * 86400 * 1000;
// Bahrain uses UTC+03:00 year-round. Never interpret these wall times in the
// browser's timezone (which may have DST gaps or repeated hours).
const BAHRAIN_OFFSET_MS = 3 * 3600 * 1000;

export function expirationFields(timestamp: number): { date: string; time: string } {
  const local = new Date(timestamp + BAHRAIN_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

export function expirationLimits(now: number) {
  return {
    min: expirationFields(Math.ceil((now + MIN_EXPIRATION_MS) / 60000) * 60000),
    max: expirationFields(Math.floor((now + MAX_EXPIRATION_MS) / 60000) * 60000),
  };
}

export function resolveExpiration(option: ExpirationOption, date: string, time: string, now: number): {
  value: ExpirationValue | null;
  dateError: string | null;
  timeError: string | null;
} {
  const preset = EXPIRATION_OPTIONS.find((entry) => entry.value === option);
  if (preset?.seconds != null) return { value: { expiresInSeconds: preset.seconds }, dateError: null, timeError: null };
  const calendarDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;
  let dateError = !date ? "Choose an expiration date."
    : !calendarDate || !Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== date
      ? "Enter a valid expiration date." : null;
  let timeError = !time ? "Choose an expiration time."
    : !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ? "Enter a valid time in hours and minutes." : null;
  const limits = expirationLimits(now);
  if (!dateError && date < limits.min.date) dateError = "Choose a date at least 15 minutes from now.";
  if (!dateError && date > limits.max.date) dateError = "Choose a date within the next 120 days.";
  if (dateError || timeError || !preset) return { value: null, dateError, timeError };

  const timestamp = Date.parse(`${date}T${time}:00+03:00`);
  if (timestamp - now < MIN_EXPIRATION_MS) timeError = "Choose a time at least 15 minutes from now.";
  if (timestamp - now > MAX_EXPIRATION_MS) timeError = "Expiration must be within 120 days.";
  return { value: timeError ? null : { expiresAt: new Date(timestamp).toISOString() }, dateError, timeError };
}

/** Presets are estimates; custom values retain the exact selected instant. */
export function expirationPreview(value: ExpirationValue, now: number): string {
  const timestamp = value.expiresAt !== undefined ? value.expiresAt : now + value.expiresInSeconds * 1000;
  const date = new Date(timestamp);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bahrain", year: "numeric", month: "long", day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bahrain", hour: "2-digit", minute: "2-digit", hour12: true,
  }).format(date);
  return `${day} at ${time}`;
}
