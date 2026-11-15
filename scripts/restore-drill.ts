import { assertNotProduction, assertSafeDatabaseUrl } from './_env';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Client } from 'pg';
import {
  existingTablesProblem,
  invoiceNumberingCheck,
  migrationCountProblem,
  missingDumpProblem,
  restoreTargetProblem,
} from '../src/infra/db/restore-drill-checks';

/**
 * Safe local restore drill (docs/deployment.md section 6).
 *
 *   pnpm db:restore-drill                      dump the local database (read-only), restore it into a new
 *                                              throwaway database, then check it
 *   pnpm db:restore-drill --dump <file>        restore a dump you already have (pg_dump -Fc) instead
 *   pnpm db:restore-drill --target <name>      throwaway database name (default lunak9_restore_test)
 *
 * Safety: local hosts only (same guard as the other scripts); never in production; the target name must
 * contain "test" and differ from the source; the target is created fresh and the script refuses if it
 * already has tables. It never removes or overwrites anything: remove an old throwaway database yourself.
 * It uses pg_dump / pg_restore from PATH, or from the local Postgres container when they are not installed
 * (set PG_CONTAINER to name it). Nothing is printed that comes from customer data, only counts.
 */
assertNotProduction('run a restore drill');
const sourceUrl = new URL(assertSafeDatabaseUrl(process.env.DATABASE_URL));
const sourceDb = sourceUrl.pathname.slice(1);

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const target = flag('--target') ?? 'lunak9_restore_test';
const targetProblem = restoreTargetProblem(sourceDb, target);
if (targetProblem) fail(targetProblem);

const targetUrl = new URL(sourceUrl.toString());
targetUrl.pathname = `/${target}`;
assertSafeDatabaseUrl(targetUrl.toString());

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

// How to run the Postgres client tools: from PATH, or inside the local Postgres container.
function toolRunner(tool: 'pg_dump' | 'pg_restore', toolArgs: string[]): { cmd: string; args: string[] } {
  if (spawnSync(tool, ['--version']).status === 0) return { cmd: tool, args: toolArgs };
  const container =
    process.env.PG_CONTAINER ??
    spawnSync('docker', ['ps', '--filter', 'ancestor=postgres:16-alpine', '--format', '{{.Names}}'], {
      encoding: 'utf8',
    })
      .stdout.split('\n')[0]
      ?.trim();
  if (!container) fail(`${tool} is not installed and no local Postgres container was found (set PG_CONTAINER).`);
  // Inside the container the database is on its own localhost.
  return {
    cmd: 'docker',
    args: ['exec', '-i', '-e', `PGPASSWORD=${decodeURIComponent(sourceUrl.password)}`, container, tool, ...toolArgs],
  };
}

function connArgs(db: string): string[] {
  return ['-U', decodeURIComponent(sourceUrl.username), '-h', 'localhost', '-p', '5432', '-d', db];
}

function run(r: { cmd: string; args: string[] }, io: { stdin?: string; stdout?: string }): Promise<void> {
  return new Promise((ok, bad) => {
    const child = spawn(r.cmd, r.args, {
      stdio: [io.stdin ? 'pipe' : 'ignore', io.stdout ? 'pipe' : 'inherit', 'inherit'],
    });
    if (io.stdin) createReadStream(io.stdin).pipe(child.stdin!);
    if (io.stdout) child.stdout!.pipe(createWriteStream(io.stdout));
    child.on('close', (code) => (code === 0 ? ok() : bad(new Error(`${r.cmd} exited with ${code}`))));
  });
}

const started = Date.now();
let dump = flag('--dump');
if (dump) {
  dump = resolve(dump);
  const dumpProblem = missingDumpProblem(dump, existsSync(dump));
  if (dumpProblem) fail(dumpProblem);
} else {
  dump = join(mkdtempSync(join(tmpdir(), 'lunak9-drill-')), 'drill.dump');
  console.log(`Dumping ${sourceDb} (read-only) to ${dump} ...`);
  // -Fc custom format, as docs/deployment.md section 6 says. No -c: the dump never clears anything first.
  await run(toolRunner('pg_dump', ['-Fc', '--no-owner', ...connArgs(sourceDb)]), { stdout: dump });
}
const dumpAgeMinutes = Math.round((Date.now() - statSync(dump).mtimeMs) / 60000);

// Create the throwaway database, refusing if it already holds tables.
const admin = new Client({
  connectionString: (() => {
    const u = new URL(sourceUrl.toString());
    u.pathname = '/postgres';
    return u.toString();
  })(),
});
await admin.connect();
const exists = (await admin.query('select 1 from pg_database where datname = $1', [target])).rowCount === 1;
if (!exists) await admin.query(`CREATE DATABASE ${target}`);
await admin.end();

const t = new Client({ connectionString: targetUrl.toString() });
await t.connect();
const tables = Number(
  (await t.query("select count(*)::int as n from information_schema.tables where table_schema in ('public','drizzle')"))
    .rows[0].n,
);
const tablesProblem = existingTablesProblem(target, tables);
if (tablesProblem) {
  await t.end();
  fail(tablesProblem);
}
await t.end();

console.log(`Restoring into ${target} ...`);
// --no-privileges as well as --no-owner: a managed host's roles will not exist in the throwaway database.
await run(toolRunner('pg_restore', ['--no-owner', '--no-privileges', ...connArgs(target)]), { stdin: dump });
const restoredMs = Date.now() - started;

// Checks (counts only, no customer data).
const c = new Client({ connectionString: targetUrl.toString() });
await c.connect();
const problems: string[] = [];
const count = async (table: string) => Number((await c.query(`select count(*)::int as n from ${table}`)).rows[0].n);

const journal = (JSON.parse(readFileSync('./drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] }).entries
  .length;
const applied = await count('drizzle.__drizzle_migrations');
const migProblem = migrationCountProblem(applied, journal);
if (migProblem) problems.push(migProblem);

const invoiceNumbers = (await c.query('select number from invoices where number is not null')).rows.map((r) =>
  String(r.number),
);
const nextInvoice = Number(
  (await c.query("select next_value from document_sequences where key = 'invoice'")).rows[0]?.next_value ?? 1,
);
const { label: numbering, problem: numberingProblem } = invoiceNumberingCheck(invoiceNumbers, nextInvoice);
if (numberingProblem) problems.push(numberingProblem);
const docs = (await c.query("select storage_key from documents where scan_status <> 'infected'")).rows.map((r) =>
  String(r.storage_key),
);
let missingFiles: number | null = null;
const storageDir = process.env.STORAGE_DIR;
if (process.env.STORAGE_DRIVER !== 's3' && storageDir) {
  const root = resolve(storageDir);
  missingFiles = docs.filter((k) => {
    const p = resolve(root, k);
    return !p.startsWith(root + sep) || !existsSync(p);
  }).length;
  if (missingFiles > 0)
    problems.push(
      `${missingFiles} of ${docs.length} documents have no file under STORAGE_DIR. Restore the bucket or folder from the same point in time.`,
    );
}
const customers = await count('customers');
const dogs = await count('dogs');
const invoices = await count('invoices');
const bookings = await count('bookings');
await c.end();

console.log('\nRestore drill result');
console.log(`  Restored into:    ${target} (source ${sourceDb} untouched)`);
console.log(`  Dump age (RPO):   about ${dumpAgeMinutes} minute(s)`);
console.log(`  Time taken (RTO): ${Math.round(restoredMs / 1000)} s for dump and restore`);
console.log(`  Migrations:       ${applied} applied, ${journal} in the code`);
console.log(
  `  Counts:           ${customers} customers, ${dogs} dogs, ${bookings} bookings, ${invoices} invoices (${invoiceNumbers.length} numbered, ${numbering})`,
);
console.log(
  `  Documents:        ${docs.length} with bytes${missingFiles === null ? ' (file check skipped: set STORAGE_DIR for the local folder; an S3 bucket is checked by hand)' : `, ${docs.length - missingFiles} found on disk`}`,
);
if (problems.length) {
  console.error('\nProblems:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(
  '\nOK. Record the date, dump age and time taken in docs/progress.md. Remove the throwaway database yourself when you are done.',
);
