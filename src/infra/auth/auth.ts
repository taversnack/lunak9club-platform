import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getDb } from '../db/client';
import * as schema from '../db/schema';
import { env, type Env } from '../env';
import { logger } from '../logger';
import { getEmailProvider } from '../email/providers';
import { magicLinkMessage, resetPasswordMessage, verifyEmailMessage } from '../email/templates';
import { decodeOrNull, safeCallbackPath } from '@/domain/auth/callback-url';
import { MAGIC_LINK_MAX, MAGIC_LINK_WINDOW_SECONDS, rateLimitedCopy } from '@/domain/auth/rate-limits';
import { userRoles, auditEvents } from '../db/schema';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? 'there';

/** Magic links expire after this many minutes and work once. */
export const MAGIC_LINK_MINUTES = 10;
const MAGIC_LINK_PATH = '/sign-in/magic-link';
const MAGIC_VERIFY_PATH = '/magic-link/verify';

/** Where a failed magic link (expired, used, refused) lands, keeping the safe way back. */
const magicErrorPath = (callback: string) => `/sign-in?callbackUrl=${encodeURIComponent(callback)}`;

/**
 * Where the rate limiter (and session records) read the client's address from. better-auth's
 * default trusts a single-value X-Forwarded-For as sent, so any client could pick a fresh rate-limit
 * bucket per request by setting that header. Only headers our own proxy controls are used here; with
 * nothing configured no header is trusted (development and tests then share 127.0.0.1, and
 * production refuses to start – see env.ts).
 */
export function clientIpOptions(e: Pick<Env, 'TRUSTED_PROXIES' | 'CLIENT_IP_HEADER'>) {
  if (e.CLIENT_IP_HEADER) return { ipAddressHeaders: [e.CLIENT_IP_HEADER] };
  if (e.TRUSTED_PROXIES.length) return { ipAddressHeaders: ['x-forwarded-for'], trustedProxies: e.TRUSTED_PROXIES };
  return { ipAddressHeaders: [] as string[] };
}

/** Exported for tests that need an instance with other settings; the app uses getAuth(). */
export function createAuth(e: Env = env()) {
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

  /**
   * Magic links are for customers only: an account qualifies if every role it holds is `customer`.
   * The Owner (and any future staff role) keeps password sign-in.
   */
  const customerOnly = async (userId: string) => {
    const roles = await db.select({ key: userRoles.roleKey }).from(userRoles).where(eq(userRoles.userId, userId));
    return roles.length > 0 && roles.every((r) => r.key === 'customer');
  };

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
        [MAGIC_LINK_PATH]: { window: MAGIC_LINK_WINDOW_SECONDS, max: MAGIC_LINK_MAX },
        [MAGIC_VERIFY_PATH]: { window: 60, max: 10 },
      },
    },
    hooks: {
      // Magic links only ever carry a same-origin path (see #50's safeCallbackPath), whatever the caller
      // sent, both when the link is requested and when it's opened (the link's query can be edited).
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === MAGIC_LINK_PATH) {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          if (
            e.AUTH_RATE_LIMIT === 'on' &&
            typeof body.email === 'string' &&
            !(await magicLinkAllowedFor(db, body.email))
          ) {
            throw new APIError('TOO_MANY_REQUESTS', { message: rateLimitedCopy(MAGIC_LINK_WINDOW_SECONDS) });
          }
          const callbackURL = safeCallbackPath(body.callbackURL);
          return {
            context: {
              body: {
                ...body,
                callbackURL,
                errorCallbackURL: magicErrorPath(callbackURL),
                newUserCallbackURL: undefined, // sign-up by magic link is off
                name: undefined,
              },
            },
          };
        }
        if (ctx.path === MAGIC_VERIFY_PATH && ctx.query) {
          const q = ctx.query as Record<string, unknown>;
          // The plugin decodes callbackURL once more itself, so check the decoded form. A malformed
          // escape (e.g. %E0%A4%A) used to throw a URIError here (HTTP 500): it now falls back.
          const callbackURL = safeCallbackPath(
            typeof q.callbackURL === 'string' ? decodeOrNull(q.callbackURL) : q.callbackURL,
          );
          return {
            context: {
              query: {
                ...q,
                callbackURL,
                errorCallbackURL: magicErrorPath(callbackURL),
                newUserCallbackURL: undefined,
              },
            },
          };
        }
      }),
    },
    advanced: {
      useSecureCookies: e.APP_URL.startsWith('https://'),
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
      ipAddress: clientIpOptions(e),
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
          // Second line of defence: even with a valid token, a magic link never signs in a non-customer.
          // Returning false stops the session; the link then redirects with an error.
          before: async (session, ctx) => {
            if (ctx?.path === MAGIC_VERIFY_PATH && !(await customerOnly(session.userId))) {
              logger.warn({ userId: session.userId }, 'magic-link sign-in refused for a non-customer account');
              await audit('auth.magic_link_refused', session.userId);
              return false;
            }
          },
          after: async (session) => {
            await audit('auth.signed_in', session.userId);
            // Inactivity (retention) is judged from this, not from sessions, which are purged.
            await db
              .update(schema.users)
              .set({ lastSignedInAt: session.createdAt ?? new Date() })
              .where(eq(schema.users.id, session.userId));
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_MINUTES * 60,
        disableSignUp: true, // customers register (name, password, terms) first
        storeToken: 'hashed', // a leaked verification table can't be replayed
        // Called for every request, known address or not. The response is always the same
        // ({ status: true }), and the email goes out in the background, so the timing doesn't
        // reveal whether an account exists either. Unknown addresses, non-customers and unconfirmed
        // addresses get nothing (verifying an unproven account here would revoke its other sign-ins).
        sendMagicLink: async ({ email, url }) => {
          await revokeEarlierMagicLinks(db, email, url);
          const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email.toLowerCase()));
          if (!user || !user.emailVerified || !(await customerOnly(user.id))) {
            if (user) await audit('auth.magic_link_refused', user.id);
            return;
          }
          void getEmailProvider()
            .send(magicLinkMessage(user.email, firstName(user.name), url, MAGIC_LINK_MINUTES))
            .then(() => audit('auth.magic_link_sent', user.id))
            .catch((err: unknown) => logger.error({ err: String(err) }, 'magic-link email failed'));
        },
      }),
      nextCookies(), // must stay last
    ],
  });
}

/**
 * "Send the link again" replaces the earlier links for that address: only the newest one works.
 * better-auth stores each link as a verification row whose identifier is the hashed token
 * (`sha256` base64url; `magic-link:<hash>` from 1.7.7) and whose value is JSON with the email.
 * The new row is written before sendMagicLink is called, so this deletes that email's other
 * rows, but only if the new row is found: if better-auth ever stores links differently, nothing
 * is revoked (tests/integration/magic-link.test.ts then fails) rather than the new link too.
 * Runs for every request, known address or not, so the timing stays the same.
 */
async function revokeEarlierMagicLinks(db: ReturnType<typeof getDb>, email: string, url: string) {
  const token = new URL(url).searchParams.get('token');
  if (!token) return;
  const hash = createHash('sha256').update(token).digest('base64url');
  const current = [hash, `magic-link:${hash}`];
  const v = schema.verifications;
  await db
    .delete(v)
    .where(
      and(
        notInArray(v.identifier, current),
        sql`case when pg_input_is_valid(${v.value}, 'jsonb') then lower(${v.value}::jsonb ->> 'email') = ${email.toLowerCase()} else false end`,
        sql`exists (select 1 from ${v} as cur where ${inArray(sql`cur.identifier`, current)})`,
      ),
    );
}

/**
 * The per-address limit on magic-link requests (Tester, #109 F1). The per-IP rule alone let anyone
 * on rotating addresses keep requesting links for someone else's email, and each request revokes
 * that person's emailed link. Counted in the same rate_limits table, under a key built from the
 * normalised address's hash (the table never holds the address itself), for every address known
 * or not, so a 429 says nothing about whether an account exists. Fixed window, counted atomically.
 */
async function magicLinkAllowedFor(db: ReturnType<typeof getDb>, email: string, now = Date.now()) {
  const key = `magic-link-email:${createHash('sha256').update(email.trim().toLowerCase()).digest('base64url')}`;
  const r = schema.rateLimits;
  const expired = sql`${r.lastRequest} <= ${now - MAGIC_LINK_WINDOW_SECONDS * 1000}`;
  const [row] = await db
    .insert(r)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: r.key,
      set: {
        count: sql`case when ${expired} then 1 else ${r.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${r.lastRequest} end`,
      },
    })
    .returning({ count: r.count });
  return (row?.count ?? 1) <= MAGIC_LINK_MAX;
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { __lunak9Auth?: Auth };

export function getAuth(): Auth {
  g.__lunak9Auth ??= createAuth();
  return g.__lunak9Auth;
}
