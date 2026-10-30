import { parseBhdToFils, type Fils } from "@filspay/money";

/** Drafts keep the decimal exactly where the user put it, including empty fractions. */
export function isBhdAmountDraft(value: string): boolean {
  return /^[0-9]*(?:\.[0-9]{0,3})?$/.test(value);
}

function completeBhdAmount(value: string): string {
  const [whole = "", fraction = ""] = value.split(".");
  return `${(whole || "0").replace(/^0+(?=[0-9])/, "")}.${fraction.padEnd(3, "0")}`;
}

/** The protected money parser performs the only conversion, with bigint intermediates. */
export function parseBhdAmountDraft(value: string): Fils | null {
  if (!isBhdAmountDraft(value) || !/[0-9]/.test(value)) return null;
  try {
    return parseBhdToFils(completeBhdAmount(value));
  } catch {
    return null;
  }
}

/** Normalize only at an editing boundary; keep empty/incomplete/unsafe drafts visible. */
export function normalizeBhdAmount(value: string): string {
  return parseBhdAmountDraft(value) === null ? value : completeBhdAmount(value);
}
