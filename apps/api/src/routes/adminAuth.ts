import { assertConsoleOtpRecipient, deliverOtpEmail } from "../auth/otpDelivery.js";
import { verifyConsoleOtp } from "../auth/consoleOtp.js";
import { authenticatorRoutes } from "./authenticator.js";
import { readAuthenticator, verifyAuthenticatorFactor } from "../auth/totp.js";
import { beginLoginAttempt, clearLoginAttempt, assertChallengeAllowed, adminAccountKey } from "../auth/loginLimits.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyPassword } from "../adminAuth/passwords.js";
import { issueAdminChallenge } from "../adminAuth/otp.js";
import { requireAdminSession } from "../adminAuth/middleware.js";
import {
  createPendingAdminSession,
  lookupPendingAdminSession,
  promoteAdminSession,
  revokeAdminSession,
  type AdminRole,
} from "../adminAuth/sessions.js";
import { withTransaction } from "../db/withTransaction.js";
import { endImpersonation } from "../admin/impersonation.js";
import { AppError, BadRequestError, GoneError, NotFoundError, TooManyRequestsError, UnauthorizedError } from "../lib/errors.js";

/**
 * A pre-computed argon2id hash of a fixed, never-used dummy password, at the
 * same cost parameters this app defaults to. Verified against on every login
 * attempt for an email that doesn't resolve to an active admin, so a failed
 * lookup and a failed password check take comparable time.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$/yKuaUqm4SW+pPt2oGNj4A$j5oxu/MdJJP86dClo0LJ0wsekKwkSbr1yA0uZSZgQcc";

interface LoginBody {
  email?: string;
  password?: string;
}

interface OtpVerifyBody {
  code?: string;
}

/** status 'disabled' blocks login and kills existing sessions (requireAdminSession re-reads it). */
interface AdminUserRow {
  id: string;
  email: string;
  role: AdminRole;
  password_hash: string;
}

/** Password sign-in requires an authenticator only for enrolled accounts. */
export async function adminAuthRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatorRoutes, { plane: "admin" });
  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== "string" || !email || typeof password !== "string" || !password) {
      throw new BadRequestError("invalid_request", "email and password are required");
    }

    const attemptId = await beginLoginAttempt(app.db, reply, app.config, { plane: "admin", accountKey: adminAccountKey(email), ip: request.ip });
    const userResult = await app.db.query<AdminUserRow>(
      `SELECT id, email, role, password_hash FROM admin_users WHERE email = $1 AND status = 'active'`,
      [email],
    );
    const user = userResult.rows[0];

    const passwordOk = await verifyPassword(user ? user.password_hash : DUMMY_PASSWORD_HASH, password);

    // The same generic error in every failure case (no row, disabled
    // account, or wrong password) — the response never discloses which.
    if (!user || !passwordOk) {
      throw new UnauthorizedError("invalid_credentials");
    }

    await clearLoginAttempt(app.db, attemptId);
    const result = await withTransaction(app.db, async (client) => {
      // Serialize with enrollment so a new factor cannot be bypassed by a concurrent login.
      const locked = await client.query<{ email: string }>(`SELECT id, email FROM admin_users WHERE id = $1 FOR UPDATE`, [user.id]);
      const factor = await readAuthenticator(client, app.config, "admin", user.id, true);
      if (factor?.enabled_at && !app.config.featureTotp) throw new AppError(503, "authenticator_unavailable");
      if (!factor?.enabled_at && app.config.otpDelivery.transport === "console") {
        if (!locked.rows[0]) throw new UnauthorizedError("invalid_credentials");
        const recipient = { plane: "admin" as const, email: locked.rows[0].email };
        assertConsoleOtpRecipient(app.config, recipient);
        await assertChallengeAllowed(client, reply, app.config, { plane: "admin", userId: user.id });
        // A new password login supersedes every previous pending challenge for this user.
        await client.query(`UPDATE admin_otp_challenges SET consumed_at = now() WHERE admin_user_id = $1 AND consumed_at IS NULL`, [user.id]);
        const challenge = await issueAdminChallenge(client, { adminUserId: user.id, ttlMinutes: app.config.adminOtpTtlMinutes,
          codeLength: 6, maxAttempts: app.config.adminOtpMaxAttempts, consoleDelivery: true });
        const session = await createPendingAdminSession(client, { adminUserId: user.id, otpChallengeId: challenge.id,
          ttlMinutes: app.config.adminPendingSessionTtlMinutes, ipAddress: request.ip,
          userAgent: (request.headers["user-agent"] as string | undefined) ?? null });
        return { session, otpRequired: true as const, expiresAt: challenge.expiresAt, verificationMethod: "console" as const,
          delivery: { ...recipient, challengeId: challenge.id, code: challenge.code, expiresAt: challenge.expiresAt } };
      }
      if (!factor?.enabled_at) {
        const pending = await createPendingAdminSession(client, { adminUserId: user.id, otpChallengeId: null,
          ttlMinutes: app.config.adminPendingSessionTtlMinutes, ipAddress: request.ip,
          userAgent: (request.headers["user-agent"] as string | undefined) ?? null });
        const session = await promoteAdminSession(client, pending.id, app.config.adminSessionTtlHours);
        return { session, otpRequired: false as const };
      }
      await assertChallengeAllowed(client, reply, app.config, { plane: "admin", userId: user.id });
      const challenge = await issueAdminChallenge(client, { adminUserId: user.id, ttlMinutes: app.config.adminOtpTtlMinutes,
        codeLength: app.config.adminOtpCodeLength, maxAttempts: app.config.adminOtpMaxAttempts });
      const session = await createPendingAdminSession(client, { adminUserId: user.id, otpChallengeId: challenge.id,
        ttlMinutes: app.config.adminPendingSessionTtlMinutes, ipAddress: request.ip,
        userAgent: (request.headers["user-agent"] as string | undefined) ?? null });
      return { session, otpRequired: true as const, expiresAt: challenge.expiresAt, verificationMethod: "totp" as const };
    });

    if ("delivery" in result && result.delivery) {
      try {
        await deliverOtpEmail(app.log, app.config, result.delivery);
      } catch (error) {
        await revokeAdminSession(app.db, result.session.id);
        throw error;
      }
    }

    let devOtp: string | undefined;
    if (app.config.otpDevExpose && "delivery" in result && result.delivery) {
      assertConsoleOtpRecipient(app.config, result.delivery);
      devOtp = result.delivery.code;
    }

    reply.header("Cache-Control", "no-store");
    reply.setCookie(app.config.adminCookieName, result.session.rawToken, {
      httpOnly: true, path: "/", sameSite: "lax", secure: app.config.cookieSecure,
      maxAge: result.otpRequired ? app.config.adminPendingSessionTtlMinutes * 60 : app.config.adminSessionTtlHours * 3_600,
    });
    reply.code(200).send(result.otpRequired
      ? { otpRequired: true, authenticated: false, verificationMethod: result.verificationMethod, otpExpiresAt: result.expiresAt.toISOString(), ...(devOtp ? { devOtp } : {}) }
      : { otpRequired: false, authenticated: true });
  });

  app.post<{ Body: OtpVerifyBody }>("/otp/verify", async (request, reply) => {
    const code = request.body?.code;
    if (typeof code !== "string" || !code || code.length > 64) {
      throw new BadRequestError("invalid_request", "code is required");
    }

    const rawToken = request.cookies[app.config.adminCookieName];
    if (!rawToken) {
      throw new UnauthorizedError("no_pending_session");
    }
    const verification = await withTransaction(app.db, async (client) => {
      const pending = await lookupPendingAdminSession(client, rawToken, true);
      if (!pending || !pending.otpChallengeId) throw new UnauthorizedError("no_pending_session");
      await client.query(`SELECT id FROM admin_users WHERE id = $1 FOR UPDATE`, [pending.adminUserId]);
      const challengeResult = await client.query<{
        id: string;
        code_salt: string;
        code_hash: string;
        attempt_count: number;
        max_attempts: number;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT id, code_salt, code_hash, attempt_count, max_attempts, expires_at, consumed_at
           FROM admin_otp_challenges WHERE id = $1 FOR UPDATE`,
        [pending.otpChallengeId],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.consumed_at !== null || challenge.expires_at.getTime() <= Date.now()) {
        throw new GoneError("otp_expired");
      }
      if (challenge.attempt_count >= challenge.max_attempts) {
        await revokeAdminSession(client, pending.adminSessionId);
        return { error: new TooManyRequestsError("too_many_attempts") } as const;
      }
      const factorValid = challenge.code_salt.startsWith("console:")
          ? await verifyConsoleOtp(client, app.config, "admin", pending.adminUserId, code, challenge.code_salt, challenge.code_hash)
          : await verifyAuthenticatorFactor(client, app.config, "admin", pending.adminUserId, code);
      if (factorValid !== true) {
        await client.query(`UPDATE admin_otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`, [challenge.id]);
        return { error: new UnauthorizedError("invalid_code") } as const;
      }
      await client.query(`UPDATE admin_otp_challenges SET consumed_at = now() WHERE id = $1`, [
        challenge.id,
      ]);
      const session = await promoteAdminSession(client, pending.adminSessionId, app.config.adminSessionTtlHours);
      const result = await client.query<{ role: AdminRole }>(
        `SELECT role FROM admin_users WHERE id = $1`,
        [pending.adminUserId],
      );
      const user = result.rows[0];
      if (!user) throw new Error("admin otp/verify: admin_users row disappeared mid-transaction");
      return { user, session, adminUserId: pending.adminUserId } as const;
    });
    if ("error" in verification) throw verification.error;

    // Re-set the cookie so its browser-side lifetime matches the now-promoted
    // session's full TTL rather than the short pending window.
    reply.setCookie(app.config.adminCookieName, verification.session.rawToken, {
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: app.config.cookieSecure,
      maxAge: app.config.adminSessionTtlHours * 3_600,
    });

    reply.code(200).send({
      authenticated: true,
      adminUserId: verification.adminUserId,
      role: verification.user.role,
    });
  });

  app.get("/me", { preHandler: requireAdminSession }, async (request: FastifyRequest) => {
    const auth = request.adminAuth;
    if (!auth) {
      throw new UnauthorizedError("unauthenticated");
    }
    return { adminUserId: auth.adminUserId, email: auth.email, role: auth.role };
  });

  app.post(
    "/logout",
    { preHandler: requireAdminSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.adminAuth;
      if (!auth) {
        throw new UnauthorizedError("unauthenticated");
      }
      const grants = await app.db.query<{ id: string }>(
        `SELECT id FROM admin_impersonation_grants
          WHERE admin_user_id = $1
            AND ended_at IS NULL
            AND revoked_at IS NULL
            AND expires_at > now()`,
        [auth.adminUserId],
      );
      for (const grant of grants.rows) {
        try {
          await endImpersonation(app.db, { adminUserId: auth.adminUserId, grantId: grant.id });
        } catch (err) {
          if (!(err instanceof NotFoundError)) throw err;
        }
      }
      await revokeAdminSession(app.db, auth.adminSessionId);
      const clearCookie = {
        httpOnly: true,
        path: "/",
        sameSite: "lax" as const,
        secure: app.config.cookieSecure,
        maxAge: 0,
      };
      reply.setCookie(app.config.adminCookieName, "", clearCookie);
      reply.setCookie(app.config.impersonationCookieName, "", clearCookie);
      reply.code(204).send();
    },
  );
}
