import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAdminAuth } from "../auth/AdminAuthContext.js";
import { describeError, WEB_BASE_URL } from "../api/client.js";
import { ImpersonationBanner } from "./ImpersonationBanner.js";
import { Brand } from "../../../ui/Brand.js";
import { Icon } from "../../../ui/Icon.js";

/** Nav shell for every admin-plane screen: who you are signed in as, the
 *  section links, a logout, and — above all of it — the impersonation
 *  banner when a grant is live. */
// YA: nav order per Huda's request (Credits first)
export function AdminLayout() {
  const { admin, signOut, impersonation } = useAdminAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div className="admin-shell">
      <a className="fp-skip-link" href="#main-content">Skip to content</a>
      <ImpersonationBanner />
      <div className="fp-workspace">
        <header className="admin-header">
          <div className="admin-brand"><Brand /><span className="fp-plane-label">Admin</span></div>
          <p className="fp-nav-caption">Operations console</p>
          <nav className="admin-nav" aria-label="Administration navigation">
            <NavLink to="/merchants"><Icon name="merchants" />Merchants</NavLink>
            <NavLink to="/credits"><Icon name="credits" />Credits</NavLink>
            <NavLink to="/settlement"><Icon name="settlement" />Settlement ops</NavLink>
            <NavLink to="/adjustment-imports"><Icon name="import" />Import adjustments</NavLink>
            <NavLink to="/webhooks"><Icon name="webhooks" />Webhook replay</NavLink>
          </nav>
          <div className="admin-identity">
            {admin ? (
              <span>
                {admin.email} <span className="admin-role-chip">{admin.role}</span>
              </span>
            ) : null}
            <button type="button" onClick={() => void handleSignOut()}>
              <Icon name="logout" />Log out
            </button>
          </div>
        </header>

        <div className="fp-workspace-content">
          <div className="fp-workspace-bar">
            <span className="fp-workspace-name">Operations console</span>
            <span className="fp-workspace-label">Administration</span>
          </div>
          {error ? <p className="admin-error" role="alert">{error}</p> : null}
          {impersonation ? (
            // An explicit exit action is required before showing admin screens.
            // The privilege boundary is enforced by the API's separate sessions.
            <main className="admin-main" id="main-content" tabIndex={-1}>
              <h1>Admin screens are paused</h1>
              <p>
                An impersonation grant is active. Use <strong>Exit impersonation</strong> above to end it
                and return to the admin console.
              </p>
              <p>
                Merchant screens are at <code>{WEB_BASE_URL}</code> while the grant lasts.
              </p>
            </main>
          ) : (
            <main className="admin-main" id="main-content" tabIndex={-1}>
              <Outlet />
            </main>
          )}
        </div>
      </div>
    </div>
  );
}
