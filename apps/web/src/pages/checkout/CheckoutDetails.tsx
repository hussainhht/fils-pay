import type { ReactNode } from "react";
import { formatBhd, toFils } from "@filspay/money";
import type { PaymentLinkPublicDto } from "../../types.js";
import { Icon } from "../../../../ui/Icon.js";

export function CheckoutIcon({ name }: { name: "lock" | "shield" | "lab" | "card" }) {
  const paths = {
    lock: "M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5zM12 14v3",
    shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
    lab: "M9 3h6m-5 0v7L4 20h16l-6-10V3M8 14h8",
    card: "M3 5h18v14H3zM3 10h18M7 15h3",
  };
  return <svg className="checkout-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

export function CheckoutMerchant({ name, children }: { name: string; children?: ReactNode }) {
  return <div className="checkout-merchant"><span className="checkout-icon-disc"><Icon name="merchants" /></span><div><strong>{name}</strong><p>{children ?? "Payment via FilsPay"}</p></div></div>;
}

export function CheckoutSummary({ link }: { link: PaymentLinkPublicDto }) {
  return <aside className="checkout-order" aria-labelledby="order-summary-title">
    <h2 id="order-summary-title">Order summary</h2>
    <CheckoutMerchant name={link.merchantDisplayName}>Payment link</CheckoutMerchant>
    {link.description ? <p className="checkout-description">{link.description}</p> : null}
    {link.reference ? <p className="checkout-reference">Reference: {link.reference}</p> : null}
    <dl className="checkout-order-total"><dt>Amount</dt><dd>{formatBhd(toFils(link.amountFils))} BHD</dd></dl>
    <div className="checkout-info-list">
      <div><span className="checkout-icon-disc"><CheckoutIcon name="card" /></span><p><strong>Payment link checkout</strong><span>One link. One payment.</span></p></div>
      <div><span className="checkout-icon-disc"><Icon name="settlement" /></span><p><strong>Amounts in Bahraini dinars</strong><span>Clearly shown in BHD.</span></p></div>
      <div><span className="checkout-icon-disc"><CheckoutIcon name="lab" /></span><p><strong>Simulated payment</strong><span>Test cards only. No real charge.</span></p></div>
    </div>
    <div className="checkout-illustration" aria-hidden="true"><svg width="300" height="180" viewBox="0 0 300 180" fill="none"><ellipse cx="150" cy="150" rx="120" ry="16" fill="#dceee3"/><path d="M20 137c43-70 58 37 111-4s89-56 150 0M28 152c40-45 67 32 115-2s93-37 131 0" stroke="#bddccb" strokeWidth="2"/><rect x="69" y="55" width="138" height="83" rx="12" fill="#fff" stroke="#b9d6c6" transform="rotate(-12 69 55)"/><path d="m82 79 125-27" stroke="#e4efe8" strokeWidth="12"/><path d="m151 38 46 17v34c0 32-46 56-46 56s-46-24-46-56V55l46-17Z" fill="#e1f2e7" stroke="#74ae8c" strokeWidth="2"/><path d="m132 89 13 13 26-29" stroke="#087f5b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/><circle cx="218" cy="41" r="5" fill="#b1d6c0"/><path d="M71 113v10m-5-5h10" stroke="#74ae8c" strokeWidth="2"/></svg><p>Simple payments.<br /><strong>Built for Bahrain.</strong></p></div>
  </aside>;
}

export function CheckoutTestInfo() {
  return <details className="checkout-test" open>
    <summary><CheckoutIcon name="lab" />Test environment<span>Simulated acquirer</span></summary>
    <p>Use test card numbers only. No real charge is made.</p>
    <p>Test cards (simulated acquirer, no real charge): any other number approves; a PAN ending <code>0002</code> always declines (do not honor); ending <code>0119</code> always declines (insufficient funds); ending <code>0069</code> always errors.</p>
  </details>;
}
