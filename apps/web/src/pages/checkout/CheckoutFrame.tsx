import type { ReactNode } from "react";
import { Brand } from "../../../../ui/Brand.js";

export function CheckoutFrame({ children, result }: {
  children: ReactNode;
  result?: "success" | "unavailable";
}) {
  return (
    <main className="checkout-page">
      <div className="checkout-masthead"><Brand /></div>
      <div className="checkout-content">
        {result ? (
          <div className={`checkout-result-symbol checkout-result-${result}`} aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={result === "success" ? "m6 12 4 4 8-8" : "M7 12h10"} />
            </svg>
          </div>
        ) : null}
        {children}
      </div>
    </main>
  );
}
