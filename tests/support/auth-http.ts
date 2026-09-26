import { getAuth } from '../../src/infra/auth/auth';

let ipCounter = 10;
/** A fresh fake client IP per test so rate limits don't bleed between tests. */
export const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

export async function authRequest(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
) {
  const res = await getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        'x-forwarded-for': init.ip ?? freshIp(),
        ...(init.cookie ? { cookie: init.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'manual',
    }),
  );
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  return { res, cookie };
}
