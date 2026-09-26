import { config } from 'dotenv';
config({ quiet: true });

/** Scripts only ever touch local or explicitly-named test databases. */
export function assertSafeDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  const host = new URL(url).hostname;
  const local = ['localhost', '127.0.0.1', 'postgres', 'db'].includes(host);
  const namedTest = /(^|[_-])test([_-]|$)/.test(new URL(url).pathname.slice(1));
  if (!local && !namedTest && process.env.ALLOW_REMOTE_DB !== 'yes-i-have-owner-approval') {
    throw new Error(`Refusing to run against non-local database host "${host}".`);
  }
  return url;
}
