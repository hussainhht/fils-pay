export const EXPIRATION_OPTIONS = [
  { value: "15-minutes", label: "15 Minutes", seconds: 900 },
  { value: "24-hours", label: "24 Hours", seconds: 86400 },
  { value: "7-days", label: "7 Days", seconds: 7 * 86400 },
  { value: "30-days", label: "30 Days", seconds: 30 * 86400 },
  { value: "90-days", label: "90 Days", seconds: 90 * 86400 },
  { value: "custom", label: "Custom Duration", seconds: null },
] as const;

export type ExpirationOption = typeof EXPIRATION_OPTIONS[number]["value"];
export type DurationUnit = "minutes" | "hours" | "days";
const UNIT_SECONDS = { minutes: 60, hours: 3600, days: 86400 };

export function expirationSeconds(option: ExpirationOption, custom: string, unit: DurationUnit): number | null {
  const preset = EXPIRATION_OPTIONS.find((entry) => entry.value === option);
  if (!preset) return null;
  if (preset.seconds !== null) return preset.seconds;
  if (!/^[0-9]+$/.test(custom) || !Object.hasOwn(UNIT_SECONDS, unit)) return null;
  const seconds = Number(custom) * UNIT_SECONDS[unit];
  return Number.isSafeInteger(seconds) && seconds >= 900 && seconds <= 120 * 86400 ? seconds : null;
}

/** Display only. The API calculates the authoritative deadline from its own clock. */
export function expirationPreview(seconds: number, now: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bahrain", year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).format(new Date(now + seconds * 1000));
}
