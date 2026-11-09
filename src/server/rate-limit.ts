import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import { sql } from 'drizzle-orm';
import type { Db } from '@/infra/db/client';
import { rateLimits } from '@/infra/db/schema';
import { env } from '@/infra/env';

/**
 * A small fixed-window limiter for server actions that have no better-auth route in front of them
 * (the auth routes are limited by better-auth itself). Counts in the same rate_limits table, atomically,
 * under the hash of a key such as `finish-signup:<hash of client address>`: no address is stored.
 */
export async function fixedWindowAllowed(
  db: Db,
  key: string,
  opts: { windowSeconds: number; max: number },
  now = Date.now(),
): Promise<boolean> {
  const hashed = createHash('sha256').update(key).digest('base64url');
  const r = rateLimits;
  const expired = sql`${r.lastRequest} <= ${now - opts.windowSeconds * 1000}`;
  const [row] = await db
    .insert(r)
    .values({ id: randomUUID(), key: hashed, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: r.key,
      set: {
        count: sql`case when ${expired} then 1 else ${r.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${r.lastRequest} end`,
      },
    })
    .returning({ count: r.count });
  return (row?.count ?? 1) <= opts.max;
}

type Trust = { TRUSTED_PROXIES: string[]; CLIENT_IP_HEADER: string | undefined };

/**
 * The caller's address by the same rules as the auth rate limit (env.ts): a header our own edge always
 * overwrites (CLIENT_IP_HEADER), or X-Forwarded-For read from the right past our trusted proxies. With
 * neither configured no header is trusted and everyone shares one bucket ('unknown'), as for the auth routes.
 */
export function clientAddress(headers: { get(name: string): string | null }, e: Trust = env()): string {
  if (e.CLIENT_IP_HEADER) {
    const v = headers.get(e.CLIENT_IP_HEADER)?.trim();
    return v && isIP(v) ? v : 'unknown';
  }
  if (e.TRUSTED_PROXIES.length) {
    const trusted = new BlockList();
    for (const p of e.TRUSTED_PROXIES) {
      const [addr, prefix] = p.split('/');
      const type = isIP(addr ?? '') === 6 ? 'ipv6' : 'ipv4';
      if (prefix === undefined) trusted.addAddress(addr!, type);
      else trusted.addSubnet(addr!, Number(prefix), type);
    }
    const chain = (headers.get('x-forwarded-for') ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    for (let i = chain.length - 1; i >= 0; i--) {
      const ip = chain[i]!;
      const family = isIP(ip);
      if (!family) return 'unknown';
      if (!trusted.check(ip, family === 6 ? 'ipv6' : 'ipv4')) return ip;
    }
  }
  return 'unknown';
}
