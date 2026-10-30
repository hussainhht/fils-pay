import type { Config } from "../config.js";
import { deliverOtpEmail, type MinimalLogger } from "../auth/otpDelivery.js";
import type { IssuedAdminOtpChallenge } from "./otp.js";

/** Admin identity and challenge stay separate from merchant authentication. */
export function sendAdminOtpCode(
  logger: MinimalLogger,
  config: Pick<Config, "nodeEnv" | "otpDelivery">,
  recipient: { adminUserId: string; email: string },
  challenge: IssuedAdminOtpChallenge,
  fetcher?: typeof fetch,
): Promise<void> {
  return deliverOtpEmail(logger, config, {
    plane: "admin", email: recipient.email, challengeId: challenge.id,
    code: challenge.code, expiresAt: challenge.expiresAt,
  }, fetcher);
}
