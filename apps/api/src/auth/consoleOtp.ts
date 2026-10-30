import type { PoolClient } from "pg";
import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { assertConsoleOtpRecipient } from "./otpDelivery.js";
import { readAuthenticator } from "./totp.js";
import { verifyOtpCode } from "./otp.js";

/** Recheck the stored identity and current policy before accepting a console challenge. */
export async function verifyConsoleOtp(client: PoolClient, config: Config, plane: "merchant" | "admin",
  userId: string, code: string, salt: string, hash: string): Promise<boolean> {
  const result = plane === "merchant"
    ? await client.query<{ email: string; test_mode: boolean }>(
      `SELECT mu.email, m.test_mode FROM merchant_users mu JOIN merchants m ON m.id = mu.merchant_id
       WHERE mu.id = $1 AND m.status = 'active'`, [userId])
    : await client.query<{ email: string; test_mode?: boolean }>(
      `SELECT email FROM admin_users WHERE id = $1 AND status = 'active'`, [userId]);
  const recipient = result.rows[0];
  if (!recipient) throw new AppError(503, "otp_delivery_unavailable");
  assertConsoleOtpRecipient(config, { plane, email: recipient.email, testMode: recipient.test_mode });
  // An enrolled authenticator must never be bypassed by an older console challenge.
  const factor = await readAuthenticator(client, config, plane, userId, true);
  if (factor?.enabled_at) throw new AppError(401, "login_required");
  return /^\d{6}$/.test(code) && verifyOtpCode(code, salt, hash);
}
