import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { magicLink } from 'better-auth/plugins/magic-link';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, notInArray, sql } from 'drizzle-orm';
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
            !(await magicLinkAllowedFor(db, body.email, browserOf(ctx.getCookie(MAGIC_BROWSER_COOKIE))))
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
        sendMagicLink: async ({ email, url }, ctx) => {
          // Which browser asked: an existing random id from our cookie, or a new one set now.
          let id = browserOf(ctx?.getCookie(MAGIC_BROWSER_COOKIE));
          if (!id && ctx) {
            id = randomBytes(24).toString('base64url');
            ctx.setCookie(MAGIC_BROWSER_COOKIE, id, {
              httpOnly: true,
              sameSite: 'lax',
              secure: (e.BETTER_AUTH_URL ?? e.APP_URL).startsWith('https:'),
              path: '/',
              maxAge: 60 * 60 * 24 * 30,
            });
          }
          await revokeEarlierMagicLinks(db, email, url, id ? sha(id) : null);
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

const MAGIC_BROWSER_COOKIE = 'lk9_ml_browser';
const BROWSER_TAG = 'lk9-browser:';
const sha = (x: string) => createHash('sha256').update(x).digest('base64url');
const emailKey = (email: string) => sha(email.trim().toLowerCase());
/** The browser id from our cookie, if it looks like one we set. */
const browserOf = (raw: string | null | undefined) => (raw && /^[A-Za-z0-9_-]{32}$/.test(raw) ? raw : null);
const isEmail = (v: typeof schema.verifications, email: string) =>
  sql`case when pg_input_is_valid(${v.value}, 'jsonb') then lower(${v.value}::jsonb ->> 'email') = ${email.trim().toLowerCase()} else false end`;

/**
 * "Send the link again" replaces the earlier links that THE SAME BROWSER asked for: only its newest
 * one works (Tester #109). Links asked for from another browser are left alone, so someone else
 * requesting links for your address can't kill the link in your inbox (Tester #113 F1); those
 * links still expire after MAGIC_LINK_MINUTES and work once.
 *
 * The browser is a random id in an httpOnly cookie, set on the first request; the link's
 * verification row is tagged with its hash. better-auth stores each link as a row whose identifier
 * is the hashed token (`sha256` base64url; `magic-link:<hash>` from 1.7.7) and whose value is JSON
 * with the email. The new row is written before sendMagicLink is called; if it isn't found (better-auth
 * changed how it stores links), nothing is tagged or revoked (tests/integration/magic-link.test.ts
 * then fails) rather than the new link too. Runs for every request, known address or not.
 */
async function revokeEarlierMagicLinks(
  db: ReturnType<typeof getDb>,
  email: string,
  url: string,
  browser: string | null,
) {
  const token = new URL(url).searchParams.get('token');
  if (!token || !browser) return;
  const hash = sha(token);
  const current = [hash, `magic-link:${hash}`];
  const v = schema.verifications;
  const tagged = await db
    .update(v)
    // better-auth parses the row strictly ({type, email, name?}); `name` is only read when signing a
    // new user up, which is disabled (disableSignUp), so the browser tag lives there.
    .set({ value: sql`(${v.value}::jsonb || ${JSON.stringify({ name: BROWSER_TAG + browser })}::jsonb)::text` })
    .where(and(inArray(v.identifier, current), isEmail(v, email)))
    .returning({ id: v.id });
  if (!tagged.length) return;
  await db
    .delete(v)
    .where(
      and(
        notInArray(v.identifier, current),
        isEmail(v, email),
        sql`case when pg_input_is_valid(${v.value}, 'jsonb') then ${v.value}::jsonb ->> 'name' = ${BROWSER_TAG + browser} else false end`,
      ),
    );
}

/** Whether this browser already has a live link for the address (it is resending). */
async function hasLiveLink(db: ReturnType<typeof getDb>, email: string, browser: string) {
  const v = schema.verifications;
  const [row] = await db
    .select({ id: v.id })
    .from(v)
    .where(
      and(
        isEmail(v, email),
        gt(v.expiresAt, new Date()),
        sql`case when pg_input_is_valid(${v.value}, 'jsonb') then ${v.value}::jsonb ->> 'name' = ${BROWSER_TAG + browser} else false end`,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The per-address limit on magic-link requests (Tester #109 F1, #113 F1): MAGIC_LINK_MAX per
 * MAGIC_LINK_WINDOW_SECONDS, counted in better-auth's rate_limits table under the hash of the
 * normalised address (the address itself is never stored), the same for every address known or
 * not, so a 429 says nothing about whether an account exists. Fixed window, counted atomically.
 *
 * A browser resending for an address it already holds a live link for counts in its own bucket
 * (address + browser), not the shared one. Strangers spending the shared bucket for your address
 * therefore can't stop you resending; and they can't use your bucket without your cookie.
 */
async function magicLinkAllowedFor(
  db: ReturnType<typeof getDb>,
  email: string,
  browserId: string | null,
  now = Date.now(),
) {
  const browser = browserId ? sha(browserId) : null;
  const own = browser && (await hasLiveLink(db, email, browser));
  const key = `magic-link-email:${emailKey(email)}${own ? `:${browser}` : ''}`;
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
