import { getDb } from '@/infra/db/client';
import { runHealthChecks } from '@/infra/db/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const checks = await runHealthChecks(getDb());
    const ok = checks.database === 'ok' && checks.migrations !== 'pending';
    return Response.json({ status: ok ? 'ok' : 'degraded', checks }, { status: ok ? 200 : 503 });
  } catch {
    // e.g. invalid environment configuration: say nothing about which setting.
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
