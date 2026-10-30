import type { Pool, PoolClient } from "pg";
import type { Config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { acceptedTotpStep, decryptTotpSecret, recoveryIndex, type AuthPlane } from "./totpCrypto.js";

// Table identifiers come only from these constants, never HTTP input.
export const authenticatorTables = {
  merchant: { factors: "merchant_authenticators", users: "merchant_users", sessions: "sessions", userColumn: "merchant_user_id" },
  admin: { factors: "admin_authenticators", users: "admin_users", sessions: "admin_sessions", userColumn: "admin_user_id" },
} as const;

export interface AuthenticatorRow {
  user_id: string;
  secret_ciphertext: string | null;
  enabled_at: Date | null;
  last_used_step: string | null;
  recovery_hashes: string[];
  pending_ciphertext: string | null;
  pending_id: string | null;
  pending_session_id: string | null;
  pending_expires_at: Date | null;
  pending_attempts: number;
}

export async function readAuthenticator(client: Pool | PoolClient, config: Config, plane: AuthPlane, userId: string, lock = false): Promise<AuthenticatorRow | null> {
  if (!config.featureTotp) return null;
  const result = await client.query<AuthenticatorRow>(
    `SELECT * FROM ${authenticatorTables[plane].factors} WHERE user_id = $1${lock ? " FOR UPDATE" : ""}`, [userId],
  );
  return result.rows[0] ?? null;
}

export function unlockAuthenticator(ciphertext: string, config: Config, plane: AuthPlane, userId: string): string {
  try {
    return decryptTotpSecret(ciphertext, config.totpSecretEncryptionKey, plane, userId);
  } catch {
    throw new AppError(503, "authenticator_unavailable", "Authenticator verification is unavailable.");
  }
}

/** Caller must commit even on false, so a recovery code/guess cannot race another request. */
export async function verifyAuthenticatorFactor(
  client: PoolClient, config: Config, plane: AuthPlane, userId: string, code: string,
): Promise<boolean | null> {
  const row = await readAuthenticator(client, config, plane, userId, true);
  if (!row?.enabled_at || !row.secret_ciphertext) return null;
  const index = recoveryIndex(code, row.recovery_hashes, plane, userId);
  if (index >= 0) {
    const remaining = row.recovery_hashes.filter((_hash, i) => i !== index);
    await client.query(`UPDATE ${authenticatorTables[plane].factors} SET recovery_hashes = $2 WHERE user_id = $1`, [userId, remaining]);
    return true;
  }
  const secret = unlockAuthenticator(row.secret_ciphertext, config, plane, userId);
  const step = await acceptedTotpStep(secret, code, row.last_used_step === null ? null : Number(row.last_used_step));
  if (step === null) return false;
  await client.query(`UPDATE ${authenticatorTables[plane].factors} SET last_used_step = $2 WHERE user_id = $1`, [userId, step]);
  return true;
}
