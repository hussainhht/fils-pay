import type { CardBrand as Brand } from "./cardInput.js";
import { cardBrandNames } from "./cardInput.js";
const logos = {
  visa: new URL("./card-brands/visa.svg", import.meta.url).href,
  mastercard: new URL("./card-brands/mastercard.svg", import.meta.url).href,
  amex: new URL("./card-brands/amex.svg", import.meta.url).href,
};

export function CardBrand({ brand }: { brand: Brand }) {
  return brand === "unknown" ? (
    <svg className="checkout-card-logo" viewBox="0 0 40 28" role="img" aria-label="Card" focusable="false">
      <rect x="1" y="1" width="38" height="26" rx="4" fill="none" stroke="currentColor" />
      <path d="M2 9h36M7 20h8" stroke="currentColor" strokeWidth="3" />
    </svg>
  ) : <img className="checkout-card-logo" src={logos[brand]} alt={cardBrandNames[brand]} width="40" height="28" />;
}
