import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@/infra/db/client';
import { env } from '@/infra/env';
import { runTick } from '@/server/services/jobs';

export const dynamic = 'force-dynamic';

function authorised(req: Request): boolean {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Scheduler entry point (GET for Vercel Cron, POST for others). Needs `Authorization: Bearer $CRON_SECRET`. */
async function handle(req: Request) {
  if (!authorised(req)) return new Response('Not found', { status: 404 });
  const result = await runTick(getDb(), { kind: 'system', job: 'scheduler' });
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
