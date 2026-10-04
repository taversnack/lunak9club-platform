import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from '../db/client';
import * as schema from '../db/schema';
import { env } from '../env';
import { logger } from '../logger';
import { getEmailProvider } from '../email/providers';
import { resetPasswordMessage, verifyEmailMessage } from '../email/templates';
import { userRoles, auditEvents } from '../db/schema';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? 'there';

function createAuth() {
  const e = env();
  const db = getDb();

  const audit = (action: string, userId: string | null) =>
    db
      .insert(auditEvents)
      .values({
        actorType: userId ? 'user' : 'system',
        actorUserId: userId,
        action,
        entityType: 'user',
        entityId: userId,
      })
      .catch((err: unknown) => logger.error({ err: String(err), action }, 'audit write failed'));

  return betterAuth({
    appName: 'Luna’s K9 Club',
    baseURL: e.BETTER_AUTH_URL ?? e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.APP_URL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        rateLimit: schema.rateLimits,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await getEmailProvider().send(resetPasswordMessage(user.email, firstName(user.name), url));
      },
      onPasswordReset: async ({ user }) => {
        await audit('auth.password_reset', user.id);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await getEmailProvider().send(verifyEmailMessage(user.email, firstName(user.name), url));
      },
      afterEmailVerification: async (user) => {
        await audit('auth.email_verified', user.id);
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh daily
      cookieCache: { enabled: false }, // always re-check the DB so revoked sessions end immediately
    },
    rateLimit: {
      enabled: e.AUTH_RATE_LIMIT === 'on',
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
        '/request-password-reset': { window: 300, max: 3 },
        '/send-verification-email': { window: 300, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: e.APP_URL.startsWith('https://'),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
    },
    databaseHooks: {
      user: {
        create: {
          // Everyone who self-registers is a customer. Owners are created by `pnpm owner:create`.
          after: async (user) => {
            await db.insert(userRoles).values({ userId: user.id, roleKey: 'customer' }).onConflictDoNothing();
            await audit('auth.registered', user.id);
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            await audit('auth.signed_in', session.userId);
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __lunak9Auth?: Auth };

export function getAuth(): Auth {
  g.__lunak9Auth ??= createAuth();
  return g.__lunak9Auth;
}
