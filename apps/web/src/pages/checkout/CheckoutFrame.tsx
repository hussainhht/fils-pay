import type { ReactNode } from "react";
import { Brand } from "../../../../ui/Brand.js";
import { CheckoutIcon } from "./CheckoutDetails.js";

export function CheckoutFrame({ children, result, summary }: {
  children: ReactNode;
  result?: "success" | "unavailable";
  summary?: ReactNode;
}) {
  return (
    <main className="checkout-page">
      <div className="checkout-layout">
      <div className="checkout-main">
      <header className="checkout-masthead"><Brand /><span><CheckoutIcon name="lock" />Payment checkout</span></header>
      <div className="checkout-content">
        {result ? (
          <div className={`checkout-result-symbol checkout-result-${result}`} aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={result === "success" ? "m6 12 4 4 8-8" : "M7 12h10"} />
            </svg>
          </div>
        ) : null}
        {children}
      </div>
      </div>
      {summary}
      </div>
    </main>
  );
}
