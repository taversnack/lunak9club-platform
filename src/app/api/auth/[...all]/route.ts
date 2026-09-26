import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/infra/auth/auth';

export const dynamic = 'force-dynamic';

const handler = (req: Request) => {
  const h = toNextJsHandler(getAuth());
  return req.method === 'GET' ? h.GET(req) : h.POST(req);
};

export { handler as GET, handler as POST };
