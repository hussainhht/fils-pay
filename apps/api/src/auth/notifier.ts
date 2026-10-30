import type { Config } from "../config.js";
import { deliverOtpEmail, type MinimalLogger } from "./otpDelivery.js";
import type { IssuedOtpChallenge } from "./otp.js";

export type { MinimalLogger } from "./otpDelivery.js";

/** Recipient comes from the password-verified user, never the request body. */
export function sendOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv" | "otpDelivery">,
  recipient: { merchantUserId: string; email: string },
  challenge: IssuedOtpChallenge,
  fetcher?: typeof fetch,
): Promise<void> {
  return deliverOtpEmail(logger, config, {
    plane: "merchant", email: recipient.email, challengeId: challenge.id,
    code: challenge.code, expiresAt: challenge.expiresAt,
  }, fetcher);
}
