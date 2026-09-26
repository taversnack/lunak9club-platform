import { sql } from 'drizzle-orm';
import { getDb } from '@/infra/db/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await getDb().execute(sql`select 1`);
    return Response.json({ status: 'ok' });
  } catch {
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
