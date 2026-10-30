import { useEffect, useState } from "react";
import "./authenticator.css";

interface Status { enabled: boolean; recoveryCodesRemaining: number }
interface Setup { enrollmentId: string; secret: string; qrDataUrl: string; expiresAt: string }
interface Props {
  prefix: string;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  describeError: (error: unknown) => string;
  plane: "merchant" | "admin";
}

/** Secrets exist only in component memory, never storage, URLs or external QR services. */
export function AuthenticatorSetup({ prefix, request, describeError, plane }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formClass = plane === "merchant" ? "dash-form" : "admin-form";

  useEffect(() => {
    let active = true;
    void request<Status>(`${prefix}/totp`).then((value) => { if (active) setStatus(value); })
      .catch((err: unknown) => { if (active) setError(describeError(err)); });
    return () => { active = false; };
  }, [prefix, request, describeError]);

  async function enroll(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const value = await request<Setup>(`${prefix}/totp/enroll`, { method: "POST", body: JSON.stringify({ password, currentCode }) });
      setPassword(""); setCurrentCode(""); setCode(""); setSetup(value);
    } catch (err) { setError(describeError(err)); }
    finally { setPassword(""); setCurrentCode(""); setBusy(false); }
  }

  async function confirm(event: React.FormEvent) {
    event.preventDefault(); if (!setup) return;
    setBusy(true); setError(null);
    try {
      const value = await request<{ recoveryCodes: string[] }>(`${prefix}/totp/confirm`, {
        method: "POST", body: JSON.stringify({ enrollmentId: setup.enrollmentId, code }),
      });
      setSetup(null); setCode(""); setRecoveryCodes(value.recoveryCodes);
      setStatus({ enabled: true, recoveryCodesRemaining: value.recoveryCodes.length });
    } catch (err) { setError(describeError(err)); }
    finally { setCode(""); setBusy(false); }
  }

  return <section className="fp-authenticator" aria-labelledby="authenticator-title">
    <div className="fp-authenticator-heading"><div><p className="fp-auth-eyebrow">Account security</p>
      <h1 id="authenticator-title">Authenticator app</h1>
      <p>Add a second layer of protection to your FilsPay {plane} account.</p></div>
      {status && <span className="fp-authenticator-status">{status.enabled ? "Enabled" : "Not set up"}</span>}
    </div>
    {error && <p className={plane === "merchant" ? "dash-error" : "admin-error"} role="alert">{error}</p>}
    {!status && !error && <p role="status">Loading account security…</p>}
    {recoveryCodes ? <div className="fp-authenticator-card">
      <h2>Save your recovery codes</h2><p>Each code works once if you lose your device. Keep them in a password manager or a secure offline location. They will not be shown again.</p>
      <ul className="fp-recovery-codes">{recoveryCodes.map((value) => <li key={value}><code>{value}</code></li>)}</ul>
      <label className="fp-recovery-saved"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} /> I saved my recovery codes securely</label>
      <button type="button" disabled={!saved} onClick={() => { setRecoveryCodes(null); setSaved(false); }}>Finish setup</button>
    </div> : setup ? <div className="fp-authenticator-grid">
      <div className="fp-authenticator-card"><p className="fp-auth-eyebrow">Step 1 · Add your account</p>
        <h2>Scan with Microsoft Authenticator</h2><p>Choose “Other account” in Microsoft Authenticator, or use another standard authenticator app.</p>
        <img className="fp-authenticator-qr" src={setup.qrDataUrl} width="256" height="256" alt="Scan this QR code with your authenticator app" />
        <details><summary>Enter a setup key manually</summary><p>Use time-based codes, 6 digits, refreshed every 30 seconds.</p><code className="fp-setup-key">{setup.secret}</code></details>
        <p>Keep this key private. Setup expires at {new Date(setup.expiresAt).toLocaleTimeString()}.</p>
      </div>
      <div className="fp-authenticator-card"><p className="fp-auth-eyebrow">Step 2 · Verify your device</p>
        <h2>Confirm a code</h2><p>Your current sign-in method stays active until you confirm the new device.</p>
        <form className={formClass} onSubmit={(e) => void confirm(e)}><label>6-digit authenticator code
          <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} /></label>
          <button type="submit" disabled={busy}>{busy ? "Verifying…" : "Activate authenticator"}</button>
          <button type="button" disabled={busy} onClick={() => { setSetup(null); setCode(""); }}>Cancel setup</button>
        </form>
      </div>
    </div> : status && <div className="fp-authenticator-card">
      <h2>{status.enabled ? "Replace your authenticator" : "Set up Microsoft Authenticator"}</h2>
      <p>{status.enabled ? `You have ${status.recoveryCodesRemaining} unused recovery codes. Replacement requires your password and current authenticator or an unused recovery code. Your old device stays active until the new one is confirmed.` : "You must already be signed in with a verified second factor. Confirm your password to add an authenticator. Password-only sign-ins cannot enroll a device."}</p>
      <form className={formClass} onSubmit={(e) => void enroll(e)}>
        <label>Current password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {status.enabled && <label>Current authenticator or recovery code<input type="text" autoComplete="off" maxLength={64} required value={currentCode} onChange={(e) => setCurrentCode(e.target.value)} /></label>}
        <button type="submit" disabled={busy}>{busy ? "Checking…" : status.enabled ? "Set up replacement device" : "Begin secure setup"}</button>
      </form>
      <p className="fp-authenticator-note">If you cannot sign in or have lost every recovery method, contact support for identity verification. A password alone cannot reset your second factor.</p>
    </div>}
  </section>;
}
