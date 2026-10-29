import { getAuth } from '../../src/infra/auth/auth';

type AuthLike = { handler: (req: Request) => Promise<Response> };

let ipCounter = 10;
/** A fresh fake client IP per test so rate limits don't bleed between tests. */
export const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export async function authRequest(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    cookie?: string;
    ip?: string;
    xff?: string;
    auth?: AuthLike;
    headers?: Record<string, string>;
  } = {},
) {
  const res = await (init.auth ?? getAuth()).handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        // `ip` is the caller's real address, appended as the trusted proxy would; `xff` is whatever
        // the caller itself sent in X-Forwarded-For (spoofable).
        'x-forwarded-for': [init.xff, init.ip ?? freshIp()].filter(Boolean).join(', '),
        ...(init.cookie ? { cookie: init.cookie } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
    }),
  );
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  return { res, cookie };
}
