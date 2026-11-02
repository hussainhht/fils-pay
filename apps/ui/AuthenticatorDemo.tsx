import React, { useState } from "react";
import { demoSecret, demoTotp, verifyDemoCode } from "./demoTotp.js";
import demoQr from "./authenticator-demo.svg";
import "./authenticator.css";

const recoveryCodes = ["DEMO-8A2C-4F91", "DEMO-5B7D-2E63", "DEMO-9C1F-6A84", "DEMO-3D8E-7B25"];

/** Standalone walkthrough. No account API calls, credentials, or persisted state. */
export function AuthenticatorDemo() {
  const [step, setStep] = useState<"intro" | "scan" | "recovery" | "done">("intro");
  const [code, setCode] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() { setStep("intro"); setCode(""); setSaved(false); setError(null); }

  async function confirm(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      if (await verifyDemoCode(code)) { setCode(""); setStep("recovery"); }
      else setError("That code doesn't match. Try the latest code from the FilsPay Demo entry, or select Use demo code.");
    } catch { setError("Demo verification needs a secure browser connection. Refresh this HTTPS page and try again."); }
    finally { setBusy(false); }
  }

  async function fillCode() {
    setError(null);
    try { setCode(await demoTotp()); }
    catch { setError("Could not generate a demo code. Open this page over HTTPS and try again."); }
  }

  return <section className="fp-authenticator" aria-labelledby="authenticator-demo-title">
    <div className="fp-authenticator-heading"><div>
      <p className="fp-auth-eyebrow">Account security · Interactive demo</p>
      <h1 id="authenticator-demo-title">Try an authenticator app</h1>
      <p>Walk through adding a device, verifying a code, and saving recovery codes.</p>
    </div><span className="fp-authenticator-status">Demo only</span></div>
    <p className="dash-confirm">This is a practice setup. It does not enable two-factor authentication or change your sign-in. The sample key and recovery codes cannot protect your account.</p>
    <ol className="fp-demo-steps" aria-label="Demo progress">
      <li aria-current={step === "intro" || step === "scan" ? "step" : undefined}>1. Add a device</li>
      <li aria-current={step === "scan" ? "step" : undefined}>2. Verify a code</li>
      <li aria-current={step === "recovery" || step === "done" ? "step" : undefined}>3. Recovery codes</li>
    </ol>
    {error && <p className="dash-error" role="alert">{error}</p>}
    {step === "intro" && <div className="fp-authenticator-card">
      <h2>See how authenticator setup works</h2>
      <p>Use Microsoft Authenticator, Google Authenticator, or try the walkthrough without a phone. No password is needed for this demo.</p>
      <button type="button" onClick={() => setStep("scan")}>Start authenticator demo</button>
    </div>}
    {step === "scan" && <div className="fp-authenticator-grid">
      <div className="fp-authenticator-card"><p className="fp-auth-eyebrow">Step 1 · Add a demo device</p>
        <h2>Scan the sample QR code</h2>
        <p>In Microsoft Authenticator, choose Other account and scan this code. The entry is named <strong>FilsPay Demo</strong>.</p>
        <img className="fp-authenticator-qr" src={demoQr} width="256" height="256" alt="Sample QR code for the FilsPay Demo authenticator entry" />
        <details><summary>Enter the sample key manually</summary><p>Choose time-based codes, 6 digits, every 30 seconds.</p><code className="fp-setup-key">{demoSecret}</code></details>
        <p className="fp-authenticator-note">This public sample key is for practice only. Remove the demo entry from your authenticator when finished.</p>
      </div>
      <div className="fp-authenticator-card"><p className="fp-auth-eyebrow">Step 2 · Verify the demo</p>
        <h2>Try a six-digit code</h2><p>Enter the code from your FilsPay Demo entry. No phone? Select Use demo code to fill a valid sample.</p>
        <form className="dash-form" onSubmit={(event) => void confirm(event)}>
          <label>6-digit demo code<input type="text" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{busy ? "Checking demo code…" : "Verify demo code"}</button>
          <button type="button" disabled={busy} onClick={() => void fillCode()}>Use demo code</button>
          <button type="button" disabled={busy} onClick={reset}>Cancel demo</button>
        </form>
      </div>
    </div>}
    {step === "recovery" && <div className="fp-authenticator-card">
      <p className="fp-auth-eyebrow">Step 3 · Practice recovery</p><h2>Save recovery codes</h2>
      <p>In a real setup, each recovery code can be used once if you lose your phone. Store them securely. These sample codes do not work for sign-in.</p>
      <ul className="fp-recovery-codes">{recoveryCodes.map((value) => <li key={value}><code>{value}</code></li>)}</ul>
      <label className="fp-recovery-saved"><input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} /> I understand how to save recovery codes</label>
      <button type="button" disabled={!saved} onClick={() => setStep("done")}>Finish demo</button>
    </div>}
    {step === "done" && <div className="fp-authenticator-card" role="status">
      <h2>Demo complete</h2><p>You tried device setup, code verification, and recovery codes. Your account sign-in is unchanged; two-factor authentication has not been enabled.</p>
      <button type="button" onClick={reset}>Try demo again</button>
    </div>}
  </section>;
}
