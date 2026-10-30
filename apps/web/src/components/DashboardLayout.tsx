import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useDashboardAuth } from "../auth/DashboardAuthContext.js";
import { RequireRole } from "../auth/RequireRole.js";
import { describeError } from "../api/client.js";
import { Brand } from "../../../ui/Brand.js";
import { Icon } from "../../../ui/Icon.js";
import "../dashboard.css";

/** Nav shell for every merchant dashboard screen. No impersonation banner
 *  here — nothing in the merchant plane impersonates anyone; when an admin
 *  "views as merchant", they arrive with a `support`-role session and see
 *  exactly what a support user sees. */
export function DashboardLayout() {
  const { me, signOut } = useDashboardAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  // sign out clears the cookie server side, local merchantId stays — am
  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/dashboard/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="dash-shell">
      <a className="fp-skip-link" href="#main-content">Skip to content</a>
      <div className="fp-workspace">
        <header className="dash-header">
          <div className="dash-brand"><Brand /></div>
          <p className="fp-nav-caption">Merchant dashboard</p>
          <nav className="dash-nav" aria-label="Merchant navigation">
            <NavLink to="/dashboard/transactions"><Icon name="transactions" />Transactions</NavLink>
            <NavLink to="/dashboard/payment-links"><Icon name="links" />Payment links</NavLink>
            {/* Every webhook route — including the plain list read — is
                owner/finance-only server-side, so the link itself is
                hidden from support rather than offered and then refused. */}
            <RequireRole allow={["owner", "finance"]}>
              <NavLink to="/dashboard/webhooks"><Icon name="webhooks" />Webhooks</NavLink>
            </RequireRole>
            <NavLink to="/dashboard/settlement"><Icon name="settlement" />Settlement</NavLink>
            <RequireRole allow={["owner", "finance"]}>
              <NavLink to="/dashboard/reconciliation"><Icon name="reconciliation" />Reconciliation</NavLink>
            </RequireRole>
            <NavLink to="/dashboard/overview"><Icon name="overview" />Overview</NavLink>
            <NavLink to="/dashboard/security">Account security</NavLink>
          </nav>
          <div className="dash-identity">
            {me ? (
              <span>
                {me.email} <span className="dash-role-chip">{me.role}</span>
              </span>
            ) : null}
            <button type="button" className="dash-button" onClick={() => void handleSignOut()}>
              <Icon name="logout" />Log out
            </button>
          </div>
        </header>

        <div className="fp-workspace-content">
          <div className="fp-workspace-bar">
            <span className="fp-workspace-name">{me?.merchant.displayName}</span>
            <span className="fp-workspace-label">Merchant dashboard</span>
          </div>
          <main className="dash-main" id="main-content" tabIndex={-1}>
            {error ? <p className="dash-error" role="alert">{error}</p> : null}
            <Outlet />
          </main>
        </div>
        </div>
      </div>
    );
  }
