import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, verifyOtp } from "../../api/dashboardAuth.js";
import { ApiError, describeError } from "../../api/client.js";
import {
  readLastMerchantId,
  useDashboardAuth,
  writeLastMerchantId,
} from "../../auth/DashboardAuthContext.js";
import type { DashboardLoginResponse } from "../../types.js";
import "../../dashboard.css";
import { Brand } from "../../../../ui/Brand.js";

type Step = { kind: "credentials" } | { kind: "otp"; challenge: DashboardLoginResponse };

export function LoginPage() {
  const { status, refresh } = useDashboardAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  // MK: remembers the last merchantId in localStorage. not a secret
  const [merchantId, setMerchantId] = useState(() => readLastMerchantId());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const isTotp = step.kind === "otp" && step.challenge.verificationMethod === "totp";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = (location.state as { from?: string } | null)?.from ?? "/dashboard/transactions";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  function backToCredentials(message: string | null): void {
    setStep({ kind: "credentials" });
    setCode("");
    setError(message);
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await login({ merchantId: merchantId.trim(), email, password });
      if (challenge.devOtp) console.log(`TEST OTP: ${challenge.devOtp}`);
      if (!challenge.otpRequired) {
        writeLastMerchantId(merchantId.trim());
        setPassword("");
        await refresh();
        navigate(redirectTo, { replace: true });
        return;
      }
      setStep({ kind: "otp", challenge });
      setPassword("");
      setUseRecovery(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  // after otp we get logged out after ~10 min. cookie ttl never extended? — am
  // MK: that's the idle timeout, by design
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp({ code });
      writeLastMerchantId(merchantId.trim());
      // The session cookie is now authenticated server-side; re-read `me` so
      // the rest of the dashboard renders from the server's answer, not from
      // the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      // `429 too_many_attempts` revokes the pending session server-side, so
      // retrying the OTP step against it can only ever fail again — start
      // over instead of leaving the user tapping a dead form.
      if (err instanceof ApiError && err.statusCode === 429 && err.code === "too_many_attempts") {
        backToCredentials(describeError(err));
      } else {
        setError(describeError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="dash-centered">
      <Brand />
      <p className="fp-auth-eyebrow">Merchant dashboard</p>
      <h1>{step.kind === "credentials" ? "Sign in to FilsPay" : "Verify your sign-in"}</h1>
      <p className="dash-muted">{step.kind === "credentials" ? "Enter your merchant account details to continue." : "Enter the one-time code for your account."}</p>

      {error ? <p className="dash-error" role="alert">{error}</p> : null}

      {step.kind === "credentials" ? (
        <form onSubmit={(e) => void handleCredentials(e)} className="dash-form">
          <label>
            Merchant ID
            <input
              type="text"
              required
              autoComplete="off"
              spellCheck={false}
              placeholder="00000000-0000-0000-0000-000000000000"
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
            />
          </label>
          <p className="dash-muted dash-hint">
            The UUID issued when your account was created. Your API integration
            already uses this value.
          </p>
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button type="submit" className="dash-button" disabled={submitting}>
            {submitting ? "Signing in..." : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void handleOtp(e)} className="dash-form">
          <p>{isTotp ? "Enter the 6-digit code from your authenticator app." : "Enter the 6-digit verification code from the test OTP console."}</p>
          <label>
            {isTotp ? (useRecovery ? "Unused recovery code" : "Authenticator code") : "Verification code"}
            <input
              type="text"
              inputMode={useRecovery ? "text" : "numeric"}
              autoComplete={useRecovery ? "off" : "one-time-code"}
              maxLength={useRecovery ? 35 : 6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {isTotp && <button type="button" disabled={submitting} onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>{useRecovery ? "Use an authenticator code" : "Use a recovery code"}</button>}
          <button type="submit" className="dash-button" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify"}
          </button>
          <button type="button" className="dash-button" onClick={() => backToCredentials(null)}>
            Start over
          </button>
        </form>
      )}
    </main>
  );
}
