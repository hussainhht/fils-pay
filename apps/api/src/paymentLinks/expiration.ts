import { BadRequestError } from "../lib/errors.js";

export const MIN_EXPIRATION_SECONDS = 15 * 60;
export const MAX_EXPIRATION_SECONDS = 120 * 24 * 60 * 60;

/** Creation-only policy. Existing links continue to use their persisted deadline. */
export function resolvePaymentLinkExpiration(
  input: { expiresAt?: unknown; expiresInSeconds?: unknown },
  now: number = Date.now(),
): Date {
  const hasInstant = input.expiresAt !== undefined;
  const hasDuration = input.expiresInSeconds !== undefined;
  if (hasInstant === hasDuration) {
    throw new BadRequestError("invalid_expiry", "Provide exactly one of expiresAt or expiresInSeconds");
  }

  if (hasDuration) {
    const seconds = input.expiresInSeconds;
    if (typeof seconds !== "number" || !Number.isSafeInteger(seconds)
      || seconds < MIN_EXPIRATION_SECONDS || seconds > MAX_EXPIRATION_SECONDS) {
      throw new BadRequestError("invalid_expiry", "expiresInSeconds must be an integer from 900 to 10368000 inclusive");
    }
    return new Date(now + seconds * 1000);
  }

  // Require an absolute ISO instant, not Date's coercion of numbers, arrays or local dates.
  const instant = input.expiresAt;
  const match = typeof instant === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(instant)
    : null;
  const timestamp = match ? Date.parse(instant as string) : NaN;
  const daysInMonth = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate() : 0;
  const durationMs = timestamp - now;
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12
    || Number(match[3]) < 1 || Number(match[3]) > daysInMonth
    || !Number.isFinite(timestamp)
    || durationMs < MIN_EXPIRATION_SECONDS * 1000 || durationMs > MAX_EXPIRATION_SECONDS * 1000) {
    throw new BadRequestError("invalid_expiry", "expiresAt must be an absolute ISO 8601 instant between 15 minutes and 120 days from server time, inclusive");
  }
  return new Date(timestamp);
}
