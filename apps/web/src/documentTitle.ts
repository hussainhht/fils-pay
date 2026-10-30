export const CHECKOUT_DOCUMENT_TITLE = "FilsPay Checkout";
export const DASHBOARD_DOCUMENT_TITLE = "FilsPay Dashboard";

/** Public checkout keeps a checkout title. Login and every dashboard screen
 *  use the dashboard title. */
export function documentTitleForPath(pathname: string): string {
  if (pathname === "/pay" || pathname.startsWith("/pay/")) return CHECKOUT_DOCUMENT_TITLE;
  return DASHBOARD_DOCUMENT_TITLE;
}
