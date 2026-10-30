import { formatCardBrandHint } from "../../utils/helpers.js";
import type { SimulatedCardInput } from "../../types.js";

export type CardBrand = ReturnType<typeof formatCardBrandHint>;
export type CardFields = { number: string; expiry: string; securityCode: string };
export type CardErrors = Partial<Record<keyof CardFields, string>>;

export const cardBrandNames: Record<CardBrand, string> = {
  visa: "Visa", mastercard: "Mastercard", amex: "American Express", unknown: "Card",
};

export const digitsOnly = (value: string): string => value.replace(/\D/g, "");
export const detectCardBrand = formatCardBrandHint;
export const securityCodeLength = (brand: CardBrand): number => brand === "amex" ? 4 : 3;

// IINs/grouping: Visa's card-input guidance and Braintree credit-card-type.
// Detection is a presentation hint, never evidence of issuer authorization.
export function formatCardNumber(value: string): string {
  const digits = digitsOnly(value);
  if (detectCardBrand(digits) === "amex") {
    return [digits.slice(0, 4), digits.slice(4, 10), digits.slice(10, 15), digits.slice(15)].filter(Boolean).join(" ");
  }
  return digits.match(/.{1,4}/g)?.join(" ") ?? "";
}

export function formatExpiry(value: string): string {
  // Accept autofill/paste in MM/YYYY as well as MM/YY. Do not guess months.
  const fullYear = value.trim().match(/^(\d{2})\s*\/?\s*20(\d{2})$/);
  const digits = fullYear ? `${fullYear[1]}${fullYear[2]}` : digitsOnly(value);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}

export function passesLuhn(value: string): boolean {
  const digits = digitsOnly(value);
  if (!/^\d{12,19}$/.test(digits) || /^0+$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    let digit = Number(digits[i]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function validateCard(fields: CardFields, now = new Date()): CardErrors {
  const pan = digitsOnly(fields.number);
  const brand = detectCardBrand(pan);
  const errors: CardErrors = {};
  const lengths = brand === "amex" ? [15] : brand === "mastercard" ? [16] : brand === "visa" ? [13, 16, 18, 19] : null;
  if (!pan) errors.number = "Enter your card number.";
  else if ((lengths && !lengths.includes(pan.length)) || !passesLuhn(pan)) errors.number = "Check your card number.";

  const expiry = fields.expiry.match(/^(\d{2})\/(\d{2})$/);
  if (!expiry) errors.expiry = "Enter an expiration date as MM/YY.";
  else {
    const month = Number(expiry[1]);
    const year = 2000 + Number(expiry[2]);
    if (month < 1 || month > 12) errors.expiry = "Enter a month from 01 to 12.";
    else if (year < now.getFullYear() || (year === now.getFullYear() && month < now.getMonth() + 1)) errors.expiry = "This card has expired.";
  }
  if (!new RegExp(`^\\d{${securityCodeLength(brand)}}$`).test(fields.securityCode)) {
    errors.securityCode = `Enter the ${securityCodeLength(brand)}-digit security code.`;
  }
  return errors;
}

export function toCardInput(fields: CardFields): SimulatedCardInput {
  const [month, year] = fields.expiry.split("/");
  return { pan: digitsOnly(fields.number), expiryMonth: Number(month), expiryYear: 2000 + Number(year), cvv: fields.securityCode };
}

type Formatter = (value: string) => string;
export interface FormattedEdit { value: string; start: number; end: number }

function positionAfterDigits(value: string, count: number): number {
  if (count === 0) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i++) if (/\d/.test(value[i]!) && ++seen === count) return i + 1;
  return value.length;
}

/** Anchor both ends of the selection to digits rather than inserted spaces. */
export function formatEdit(value: string, start: number, end: number, format: Formatter): FormattedEdit {
  const formatted = format(value);
  return { value: formatted, start: positionAfterDigits(formatted, digitsOnly(value.slice(0, start)).length),
    end: positionAfterDigits(formatted, digitsOnly(value.slice(0, end)).length) };
}

/** Backspace/delete beside a generated separator must remove a digit. */
export function deleteBesideSeparator(value: string, start: number, end: number, key: string, format: Formatter): FormattedEdit | null {
  if (start !== end) return null;
  const index = key === "Backspace" ? start - 1 : key === "Delete" ? start : -1;
  if (index < 0 || index >= value.length || /\d/.test(value[index]!)) return null;
  const digitIndex = key === "Backspace" ? index - 1 : index + 1;
  if (digitIndex < 0 || digitIndex >= value.length) return null;
  const next = value.slice(0, digitIndex) + value.slice(digitIndex + 1);
  const caret = key === "Backspace" ? digitIndex : start;
  return formatEdit(next, caret, caret, format);
}

export function linkHasExpired(expiresAt: string, now = Date.now()): boolean {
  const expiry = Date.parse(expiresAt);
  return !Number.isFinite(expiry) || expiry <= now;
}
