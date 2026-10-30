import { authenticatorRoutes } from "./authenticator.js";
import { readAuthenticator, verifyAuthenticatorFactor } from "../auth/totp.js";
import { beginLoginAttempt, clearLoginAttempt, assertChallengeAllowed, merchantAccountKey } from "../auth/loginLimits.js";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyPassword } from "../auth/passwords.js";
import { issueChallenge } from "../auth/otp.js";
import { requireDashboardIdentity, requireSession } from "../auth/middleware.js";
import {
  createPendingSession,
  lookupPendingSession,
  promoteSession,
  revokeSession,
} from "../auth/sessions.js";
import { withTransaction } from "../db/withTransaction.js";
import { AppError, BadRequestError, GoneError, TooManyRequestsError, UnauthorizedError } from "../lib/errors.js";

/**
 * A pre-computed argon2id hash of a fixed, never-used dummy password, at
 * the same cost parameters this app defaults to. Verified against on every
 * login attempt for an email/merchant pair that doesn't resolve to a real
 * user, so a failed lookup and a failed password check take comparable
 * time — the response is already generic ("invalid_credentials") in every
 * case; this narrows the timing side-channel to match.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=19456,p=1,t=2$/yKuaUqm4SW+pPt2oGNj4A$j5oxu/MdJJP86dClo0LJ0wsekKwkSbr1yA0uZSZgQcc";

interface LoginBody {
  merchantId?: string;
  email?: string;
  password?: string;
}

interface OtpVerifyBody {
  code?: string;
}

/** One row per (merchant_id, email); the same email may exist under several merchants. */
interface MerchantUserRow {
  id: string;
  merchant_id: string;
  email: string;
  role: "owner" | "finance" | "support";
  password_hash: string;
}

/** Password sign-in requires an authenticator only for enrolled accounts. */
export async function authRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatorRoutes, { plane: "merchant" });
  /** POST /v1/auth/login — step 1. */
  app.post<{ Body: LoginBody }>("/login", async (request, reply) => {
    const { merchantId, email, password } = request.body ?? {};
    if (typeof merchantId !== "string" || !merchantId || typeof email !== "string" || !email || typeof password !== "string" || !password) {
      throw new BadRequestError("invalid_request", "merchantId, email and password are required");
    }

    const attemptId = await beginLoginAttempt(app.db, reply, app.config, { plane: "merchant", accountKey: merchantAccountKey(merchantId, email), ip: request.ip });
    const userResult = await app.db.query<MerchantUserRow>(
      `SELECT mu.id, mu.merchant_id, mu.email, mu.role, mu.password_hash
         FROM merchant_users mu
         JOIN merchants m ON m.id = mu.merchant_id
        WHERE mu.merchant_id = $1 AND mu.email = $2 AND m.status = 'active'`,
      [merchantId, email],
    );
    const user = userResult.rows[0];

    // timing-safe: hashes against a dummy when the user is missing. correct — FH
    const passwordOk = await verifyPassword(user ? user.password_hash : DUMMY_PASSWORD_HASH, password);

    // The same generic message in every failure case (no row, or wrong
    // password) — the response never discloses which part was wrong.
    if (!user || !passwordOk) {
      throw new UnauthorizedError("invalid_credentials");
    }

    await clearLoginAttempt(app.db, attemptId);
    const result = await withTransaction(app.db, async (client) => {
      // Serialize with enrollment so a new factor cannot be bypassed by a concurrent login.
      await client.query(`SELECT id FROM merchant_users WHERE id = $1 FOR UPDATE`, [user.id]);
      const factor = await readAuthenticator(client, app.config, "merchant", user.id, true);
      if (factor?.enabled_at && !app.config.featureTotp) throw new AppError(503, "authenticator_unavailable");
      if (!factor?.enabled_at) {
        const pending = await createPendingSession(client, { merchantUserId: user.id, otpChallengeId: null,
          ttlMinutes: app.config.pendingSessionTtlMinutes, ipAddress: request.ip,
          userAgent: (request.headers["user-agent"] as string | undefined) ?? null });
        const session = await promoteSession(client, pending.id, app.config.sessionTtlHours);
        return { session, otpRequired: false as const };
      }
      await assertChallengeAllowed(client, reply, app.config, { plane: "merchant", userId: user.id });
      const challenge = await issueChallenge(client, { merchantUserId: user.id, ttlMinutes: app.config.otpTtlMinutes,
        codeLength: app.config.otpCodeLength, maxAttempts: app.config.otpMaxAttempts });
      const session = await createPendingSession(client, { merchantUserId: user.id, otpChallengeId: challenge.id,
        ttlMinutes: app.config.pendingSessionTtlMinutes, ipAddress: request.ip,
        userAgent: (request.headers["user-agent"] as string | undefined) ?? null });
      return { session, otpRequired: true as const, expiresAt: challenge.expiresAt };
    });

    reply.setCookie(app.config.cookieName, result.session.rawToken, {
      httpOnly: true, path: "/", sameSite: "lax", secure: app.config.cookieSecure,
      maxAge: result.otpRequired ? app.config.pendingSessionTtlMinutes * 60 : app.config.sessionTtlHours * 3_600,
    });
    reply.code(200).send(result.otpRequired
      ? { otpRequired: true, verificationMethod: "totp", otpExpiresAt: result.expiresAt.toISOString() }
      : { otpRequired: false, authenticated: true });
  });

  app.post<{ Body: OtpVerifyBody }>(
    "/otp/verify",
    async (request, reply) => {
      const code = request.body?.code;
      if (typeof code !== "string" || !code || code.length > 64) {
        throw new BadRequestError("invalid_request", "code is required");
      }

      const rawToken = request.cookies[app.config.cookieName];
      if (!rawToken) {
        throw new UnauthorizedError("no_pending_session");
      }
      const verification = await withTransaction(app.db, async (client) => {
        // Verify and resend lock the same session before reading its current
        // challenge, so neither can race an old challenge or promote twice.
        const pending = await lookupPendingSession(client, rawToken, true);
        if (!pending || !pending.otpChallengeId) throw new UnauthorizedError("no_pending_session");
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
             FROM otp_challenges WHERE id = $1 FOR UPDATE`,
          [pending.otpChallengeId],
        );
        const challenge = challengeResult.rows[0];
        if (!challenge || challenge.consumed_at !== null || challenge.expires_at.getTime() <= Date.now()) {
          throw new GoneError("otp_expired");
        }
        if (challenge.attempt_count >= challenge.max_attempts) {
          await revokeSession(client, pending.sessionId);
          return { error: new TooManyRequestsError("too_many_attempts") } as const;
        }
        const factorValid = await verifyAuthenticatorFactor(client, app.config, "merchant", pending.merchantUserId, code);
        if (factorValid !== true) {
          await client.query(`UPDATE otp_challenges SET attempt_count = attempt_count + 1 WHERE id = $1`, [challenge.id]);
          // Return the failure so the attempt increment commits before the
          // HTTP error is thrown outside the transaction.
          return { error: new UnauthorizedError("invalid_code") } as const;
        }
        await client.query(`UPDATE otp_challenges SET consumed_at = now() WHERE id = $1`, [challenge.id]);
        const session = await promoteSession(client, pending.sessionId, app.config.sessionTtlHours);
        const result = await client.query<{ merchant_id: string; role: "owner" | "finance" | "support" }>(
          `SELECT merchant_id, role FROM merchant_users WHERE id = $1`,
          [pending.merchantUserId],
        );
        const user = result.rows[0];
        if (!user) throw new Error("otp/verify: merchant_users row disappeared mid-transaction");
        return { user, session } as const;
      });
      if ("error" in verification) throw verification.error;

      reply.setCookie(app.config.cookieName, verification.session.rawToken, {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: app.config.cookieSecure,
        maxAge: app.config.sessionTtlHours * 3_600,
      });

      reply.code(200).send({
        authenticated: true,
        merchantId: verification.user.merchant_id,
        role: verification.user.role,
      });
    },
  );

  app.get(
    "/me",
    { preHandler: requireDashboardIdentity },
    async (request: FastifyRequest) => {
      const grant = request.dashboardImpersonation;
      if (grant) {
        const granted = await app.db.query<{
          email: string;
          merchant_id: string;
          display_name: string;
          onboarding_status: string;
          refunds_enabled: boolean | null;
        }>(
          `SELECT au.email, m.id AS merchant_id, m.display_name, m.onboarding_status, m.refunds_enabled
             FROM merchants m
             JOIN admin_users au ON au.id = $2
            WHERE m.id = $1 AND au.status = 'active'`,
          [grant.merchantId, grant.adminUserId],
        );
        const grantedRow = granted.rows[0];
        if (!grantedRow) {
          throw new UnauthorizedError("unauthenticated");
        }
        return {
          merchantUserId: grant.grantId,
          email: grantedRow.email,
          role: grant.merchantRole,
          merchant: {
            id: grantedRow.merchant_id,
            displayName: grantedRow.display_name,
            onboardingStatus: grantedRow.onboarding_status,
            refundsEnabled: app.config.featureRefunds && grantedRow.refunds_enabled !== false,
          },
          impersonation: { grantId: grant.grantId, adminUserId: grant.adminUserId },
        };
      }

      const auth = request.auth;
      if (!auth) {
        throw new UnauthorizedError("unauthenticated");
      }
      const result = await app.db.query<{
        email: string;
        merchant_id: string;
        display_name: string;
        onboarding_status: string;
        refunds_enabled: boolean | null;
      }>(
        `SELECT mu.email, m.id AS merchant_id, m.display_name, m.onboarding_status, m.refunds_enabled
           FROM merchant_users mu
           JOIN merchants m ON m.id = mu.merchant_id
          WHERE mu.id = $1`,
        [auth.merchantUserId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new UnauthorizedError("unauthenticated");
      }
      return {
        merchantUserId: auth.merchantUserId,
        email: row.email,
        role: auth.role,
        merchant: {
          id: row.merchant_id,
          displayName: row.display_name,
          onboardingStatus: row.onboarding_status,
          refundsEnabled: app.config.featureRefunds && row.refunds_enabled !== false,
        },
      };
    },
  );

  app.post(
    "/logout",
    { preHandler: requireSession },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth;
      if (!auth) {
        throw new UnauthorizedError("unauthenticated");
      }
      await revokeSession(app.db, auth.sessionId);
      reply.setCookie(app.config.cookieName, "", {
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: app.config.cookieSecure,
        maxAge: 0,
      });
      reply.code(204).send();
    },
  );
}
