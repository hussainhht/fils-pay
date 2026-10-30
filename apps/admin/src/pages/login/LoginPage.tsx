import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { login, verifyOtp } from "../../api/auth.js";
import { describeError } from "../../api/client.js";
import { useAdminAuth } from "../../auth/AdminAuthContext.js";
import type { AdminLoginResponse } from "../../types.js";
import { Brand } from "../../../../ui/Brand.js";

type Step =
  | { kind: "credentials" }
  | { kind: "otp"; challenge: AdminLoginResponse };

export function LoginPage() {
  const { status, refresh } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const isTotp = step.kind === "otp" && step.challenge.verificationMethod === "totp";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/merchants";

  if (status === "authenticated") {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleCredentials(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const challenge = await login({ email, password });
      if (!challenge.otpRequired) {
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

  // YA: admin verify re-issues the cookie with the full TTL
  async function handleOtp(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await verifyOtp({ code });
      // The session cookie is now authenticated server-side; re-read `me`
      // so the rest of the console renders from the server's answer, not
      // from the verify response we happen to be holding.
      await refresh();
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-centered">
      <Brand />
      <p className="fp-auth-eyebrow">Administration</p>
      <h1>{step.kind === "credentials" ? "Sign in to the console" : "Verify your sign-in"}</h1>
      <p className="admin-muted">Internal operations console.</p>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      {step.kind === "credentials" ? (
        <form onSubmit={(e) => void handleCredentials(e)} className="admin-form">
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
          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={(e) => void handleOtp(e)} className="admin-form">
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
          <button type="submit" disabled={submitting}>
            {submitting ? "Verifying..." : "Verify"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStep({ kind: "credentials" });
              setCode("");
              setError(null);
            }}
          >
            Start over
          </button>
        </form>
      )}
    </main>
  );
}
