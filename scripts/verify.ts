// `pnpm verify` — runs every quality gate, continues after failures so the report is complete,
// and prints an honest pass/fail table. Touches .claude/.last-verify only when everything passes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

type Step = { name: string; cmd: string; optional?: boolean };
const steps: Step[] = [
  { name: 'Format', cmd: 'pnpm -s format:check' },
  { name: 'Lint', cmd: 'pnpm -s lint' },
  { name: 'Typecheck', cmd: 'pnpm -s typecheck' },
  { name: 'Unit tests', cmd: 'pnpm -s test' },
  { name: 'Integration + authz tests (migrates test DB from zero)', cmd: 'pnpm -s test:int' },
  { name: 'Migration consistency', cmd: 'pnpm -s exec drizzle-kit check' },
  { name: 'Build', cmd: 'pnpm -s build' },
  { name: 'E2E tests', cmd: 'pnpm -s test:e2e' },
  { name: 'Accessibility tests', cmd: 'pnpm -s test:a11y' },
  { name: 'Dependency audit (prod)', cmd: 'pnpm audit --prod --audit-level high', optional: true },
  {
    name: 'Secret scan (gitleaks)',
    cmd: 'command -v gitleaks >/dev/null || exit 99; if [ -d .git ]; then gitleaks git --no-banner --redact; else gitleaks dir . --no-banner --redact; fi',
    optional: true,
  },
];

const rows: string[] = [];
let failed = 0;
for (const s of steps) {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${s.name}: ${s.cmd}\n`);
  const r = spawnSync(s.cmd, { shell: true, stdio: 'inherit' });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const result =
    r.status === 0
      ? 'PASS'
      : r.status === 99
        ? 'SKIPPED (tool not installed)'
        : s.optional
          ? `WARN (exit ${r.status})`
          : `FAIL (exit ${r.status})`;
  if (result.startsWith('FAIL')) failed++;
  rows.push(`| ${s.name} | \`${s.cmd}\` | ${result} | ${secs}s |`);
}

console.log('\n| Step | Command | Result | Time |\n|---|---|---|---|\n' + rows.join('\n'));
console.log(failed ? `\nOVERALL: FAIL (${failed} step(s) failed)` : '\nOVERALL: PASS');
if (!failed) {
  mkdirSync('.claude', { recursive: true });
  writeFileSync('.claude/.last-verify', new Date().toISOString());
}
process.exit(failed ? 1 : 0);
