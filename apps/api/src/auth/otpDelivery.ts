import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";

export interface OtpMessage {
  plane: "merchant" | "admin";
  email: string;
  challengeId: string;
  code: string;
  expiresAt: Date;
  testMode?: boolean;
}

export interface MinimalLogger {
  info: (obj: Record<string, unknown>, msg: string) => void;
}

const deliveryError = () => new AppError(503, "otp_delivery_unavailable", "Unable to deliver verification code. Try again later.");

/** Fail closed on missing allowlists; merchant eligibility also requires DB test_mode. */
export function assertConsoleOtpRecipient(config: Pick<Config, "otpDelivery">,
  recipient: { plane: "merchant" | "admin"; email: string; testMode?: boolean }): void {
  const allowed = recipient.plane === "merchant"
    ? recipient.testMode === true && config.otpDelivery.testMerchantEmails?.includes(recipient.email.toLowerCase())
    : config.otpDelivery.testAdminEmails?.includes(recipient.email.toLowerCase());
  if (config.otpDelivery.transport !== "console" || !allowed) throw deliveryError();
}

/** One bounded submission, after challenge/session commit. Never retries an ambiguous send. */
export async function deliverOtpEmail(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv" | "otpDelivery">,
  message: OtpMessage,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (config.otpDelivery.transport === "console") {
    assertConsoleOtpRecipient(config, message);
    const expiresIn = Math.ceil((message.expiresAt.getTime() - Date.now()) / 1000);
    if (!/^\d{6}$/.test(message.code) || !Number.isFinite(expiresIn) || expiresIn <= 0) throw deliveryError();
    logger.info({ plane: message.plane, recipient: message.email, code: message.code, expires_in: expiresIn },
      "TEST OTP | temporary console delivery");
    return;
  }
  if (config.otpDelivery.transport === "disabled") throw deliveryError();
  if (config.otpDelivery.transport === "development") {
    if (config.nodeEnv === "production") throw deliveryError();
    logger.info({ plane: message.plane }, "otp delivery disabled (development)");
    return;
  }
  const { apiKey, from, timeoutMs } = config.otpDelivery;
  if (!apiKey || !from || !/^[^\s@<>,;:"\\]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(message.email) ||
      !/^[A-Za-z0-9-]+$/.test(message.challengeId) || !/^\d+$/.test(message.code) ||
      !Number.isFinite(message.expiresAt.getTime()) || message.expiresAt.getTime() <= Date.now()) {
    throw deliveryError();
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const submission = (async () => {
      const response = await fetcher("https://api.resend.com/emails", {
        method: "POST",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `filspay-otp/${message.plane}/${message.challengeId}`,
        },
        body: JSON.stringify({
          from,
          to: [message.email],
          subject: `FilsPay ${message.plane} verification code`,
          text: `Your FilsPay ${message.plane} verification code is ${message.code}.\nExpires at ${message.expiresAt.toISOString()}. Do not share this code.`,
        }),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw deliveryError();
      }
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("id" in result) || typeof result.id !== "string" || !result.id) {
        throw deliveryError();
      }
    })();
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(deliveryError());
      }, timeoutMs);
    });
    await Promise.race([submission, timeout]);
    logger.info({ plane: message.plane }, "otp email accepted by provider");
  } catch {
    // Provider bodies/errors can contain recipients, credentials or message text.
    throw deliveryError();
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
