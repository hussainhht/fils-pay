import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { requireSession } from "../auth/middleware.js";
import { requireAdminSession } from "../adminAuth/middleware.js";
import { beginLoginAttempt, clearLoginAttempt } from "../auth/loginLimits.js";
import { verifyPassword } from "../auth/passwords.js";
import { createRecoveryCodes, createTotpSetup, encryptTotpSecret, acceptedTotpStep, type AuthPlane } from "../auth/totpCrypto.js";
import { authenticatorTables, readAuthenticator, unlockAuthenticator, verifyAuthenticatorFactor } from "../auth/totp.js";
import { withTransaction } from "../db/withTransaction.js";
import { insertAdminAuditLog } from "../adminAudit/log.js";
import { AppError, BadRequestError, ForbiddenError, GoneError, TooManyRequestsError, UnauthorizedError } from "../lib/errors.js";

interface EnrollmentBody { password?: string; currentCode?: string; enrollmentId?: string; code?: string }

/** Registered separately below each plane's auth prefix; no client-selectable identity/plane. */
export async function authenticatorRoutes(app: FastifyInstance, options: { plane: AuthPlane }): Promise<void> {
  const plane = options.plane;
  const tables = authenticatorTables[plane];
  const identity = (request: FastifyRequest) => plane === "merchant"
    ? { userId: request.auth!.merchantUserId, sessionId: request.auth!.sessionId }
    : { userId: request.adminAuth!.adminUserId, sessionId: request.adminAuth!.adminSessionId };

  async function lockTrustedSessions(client: PoolClient, userId: string, sessionId: string, all: boolean) {
    // Session-before-factor matches login verification and avoids a revocation/verification deadlock.
    const sessions = await client.query<{ id: string; authenticated: boolean }>(
      `SELECT id, authenticated FROM ${tables.sessions} WHERE ${tables.userColumn} = $1
         AND revoked_at IS NULL AND expires_at > now() ${all ? "" : "AND id = $2"} ORDER BY id FOR UPDATE`,
      all ? [userId] : [userId, sessionId],
    );
    if (!sessions.rows.some((session) => session.id === sessionId && session.authenticated)) throw new UnauthorizedError("unauthenticated");
  }

  async function protect(request: FastifyRequest, reply: FastifyReply) {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    if (!app.config.featureTotp) throw new AppError(503, "authenticator_unavailable");
    if (request.cookies[app.config.impersonationCookieName]) throw new ForbiddenError("impersonation_read_only");
    const origin = request.headers.origin;
    if (origin) {
      let host: string;
      try { host = new URL(origin).host; } catch { throw new ForbiddenError("invalid_origin"); }
      if (host !== request.headers.host) throw new ForbiddenError("invalid_origin");
    }
    if (plane === "merchant") await requireSession.call(app, request, reply, () => {});
    else await requireAdminSession.call(app, request, reply, () => {});
  }

  app.get("/totp", { preHandler: protect }, async (request) => {
    const { userId } = identity(request);
    const row = await readAuthenticator(app.db, app.config, plane, userId);
    return { enabled: !!row?.enabled_at, recoveryCodesRemaining: row?.recovery_hashes.length ?? 0 };
  });

  app.post<{ Body: EnrollmentBody }>("/totp/enroll", { preHandler: protect }, async (request, reply) => {
    const { userId, sessionId } = identity(request);
    const password = request.body?.password;
    if (typeof password !== "string" || !password) throw new BadRequestError("password_required");
    if (request.body.currentCode !== undefined && (typeof request.body.currentCode !== "string" || request.body.currentCode.length > 64)) throw new BadRequestError("invalid_request");
    const attemptId = await beginLoginAttempt(app.db, reply, app.config, { plane, accountKey: `totp-management:${userId}`, ip: request.ip });
    // Password verification uses the current stored hash; no arbitrary recipient/identity is accepted.
    const userResult = await app.db.query<{ email: string; password_hash: string }>(
      `SELECT email, password_hash FROM ${tables.users} WHERE id = $1`, [userId],
    );
    const user = userResult.rows[0];
    if (!user || !await verifyPassword(user.password_hash, password)) throw new UnauthorizedError("invalid_credentials");
    const setup = await createTotpSetup(plane, `${userId}:${user.email}`);
    const enrollmentId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const result = await withTransaction(app.db, async (client) => {
      await lockTrustedSessions(client, userId, sessionId, false);
      // Serialize initial enrollment too, when an authenticator row does not yet exist.
      await client.query(`SELECT id FROM ${tables.users} WHERE id = $1 FOR UPDATE`, [userId]);
      const row = await readAuthenticator(client, app.config, plane, userId, true);
      if (row?.enabled_at && !await verifyAuthenticatorFactor(client, app.config, plane, userId, request.body.currentCode ?? "")) {
        return { error: new UnauthorizedError("invalid_code") } as const;
      }
      const encrypted = encryptTotpSecret(setup.secret, app.config.totpSecretEncryptionKey, plane, userId);
      await client.query(
        `INSERT INTO ${tables.factors} (user_id, pending_ciphertext, pending_id, pending_session_id, pending_expires_at, pending_attempts)
         VALUES ($1, $2, $3, $4, $5, 0)
         ON CONFLICT (user_id) DO UPDATE SET pending_ciphertext = $2, pending_id = $3,
           pending_session_id = $4, pending_expires_at = $5, pending_attempts = 0`,
        [userId, encrypted, enrollmentId, sessionId, expiresAt],
      );
      if (plane === "admin") await insertAdminAuditLog(client, {
        adminUserId: userId, action: "authenticator_enrollment_started", targetType: "admin_user", targetId: userId,
        metadata: { replacement: !!row?.enabled_at },
      });
      return { ok: true } as const;
    });
    if ("error" in result) throw result.error;
    await clearLoginAttempt(app.db, attemptId);
    return { enrollmentId, secret: setup.secret, qrDataUrl: setup.qrDataUrl, expiresAt: expiresAt.toISOString() };
  });

  app.post<{ Body: EnrollmentBody }>("/totp/confirm", { preHandler: protect }, async (request) => {
    const { userId, sessionId } = identity(request);
    const { enrollmentId, code } = request.body ?? {};
    if (typeof enrollmentId !== "string" || typeof code !== "string" || !/^\d{6}$/.test(code)) throw new BadRequestError("invalid_request");
    const confirmed = await withTransaction(app.db, async (client) => {
      await lockTrustedSessions(client, userId, sessionId, true);
      await client.query(`SELECT id FROM ${tables.users} WHERE id = $1 FOR UPDATE`, [userId]);
      const row = await readAuthenticator(client, app.config, plane, userId, true);
      if (!row?.pending_ciphertext || row.pending_id !== enrollmentId || row.pending_session_id !== sessionId ||
          !row.pending_expires_at || row.pending_expires_at.getTime() <= Date.now()) throw new GoneError("enrollment_expired");
      if (row.pending_attempts >= 5) throw new TooManyRequestsError("too_many_attempts");
      const step = await acceptedTotpStep(unlockAuthenticator(row.pending_ciphertext, app.config, plane, userId), code, null);
      if (step === null) {
        await client.query(`UPDATE ${tables.factors} SET pending_attempts = pending_attempts + 1 WHERE user_id = $1`, [userId]);
        return { error: new UnauthorizedError("invalid_code") } as const;
      }
      const recovery = createRecoveryCodes(plane, userId);
      await client.query(
        `UPDATE ${tables.factors} SET secret_ciphertext = pending_ciphertext, enabled_at = now(), last_used_step = $2,
           recovery_hashes = $3, pending_ciphertext = NULL, pending_id = NULL, pending_session_id = NULL,
           pending_expires_at = NULL, pending_attempts = 0 WHERE user_id = $1`, [userId, step, recovery.hashes],
      );
      // Invalidate stale sessions/pending logins after changing a factor, while preserving this proven session.
      await client.query(`UPDATE ${tables.sessions} SET revoked_at = now() WHERE ${tables.userColumn} = $1 AND id <> $2 AND revoked_at IS NULL`, [userId, sessionId]);
      if (plane === "admin") await insertAdminAuditLog(client, {
        adminUserId: userId, action: "authenticator_activated", targetType: "admin_user", targetId: userId,
        metadata: { replacement: !!row.enabled_at },
      });
      return { recoveryCodes: recovery.codes } as const;
    });
    if ("error" in confirmed) throw confirmed.error;
    return { enabled: true, recoveryCodes: confirmed.recoveryCodes };
  });
}
