// PreToolUse(Bash): blocks production-targeted, destructive or live-money commands,
// and runs a secrets check before git commit.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readInput, block } from './lib.mjs';

const input = await readInput();
const cmd = String(input?.tool_input?.command ?? '');
const env = process.env;

const rules = [
  [/\bdrizzle-kit\s+push\b/, 'drizzle-kit push bypasses reviewed migrations. Use /create-migration and pnpm db:migrate.'],
  [/\bvercel\b.*--prod\b/, 'Production deploys need explicit Owner approval and are never run from Claude.'],
  [/\bgit\s+push\b.*(--force|-f\b)/, 'Force push is blocked.'],
  [/sk_live_[A-Za-z0-9]/, 'Live Stripe keys must never be used from Claude.'],
  [/\bstripe\b.*--live\b/, 'Stripe CLI live mode is blocked.'],
  [/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE)\b/i, 'Destructive SQL is blocked from the shell. Put it in a reviewed migration with a rollback plan.'],
  [/\brm\s+-rf?\s+(\/|~|\$HOME|\.\s*$)/, 'Broad rm is blocked.'],
  [/\b(month-end|membership-invoicing|send-reminders)\b.*--live\b/, 'Live month-end/reminder runs need explicit Owner approval.'],
];
for (const [re, why] of rules) if (re.test(cmd)) block(why);

// Migrations only against local/test databases.
if (/\b(db:migrate|drizzle-kit\s+migrate|db:reset|db:seed)\b/.test(cmd)) {
  const url = (cmd.match(/DATABASE_URL=(\S+)/)?.[1]) ?? env.DATABASE_URL ?? '';
  if (url && !/(localhost|127\.0\.0\.1|@db:|@postgres:|-test\b|test_|_test)/.test(url)) {
    block('Migration/seed/reset target does not look local or test. Refusing.');
  }
}

// Email sends must be sandboxed.
if (/\b(send-email|email:send)\b/.test(cmd) && env.EMAIL_SANDBOX !== '1' && !/EMAIL_SANDBOX=1/.test(cmd)) {
  block('Email send scripts require EMAIL_SANDBOX=1.');
}

// Pre-commit secrets / artefact check.
if (/\bgit\s+commit\b/.test(cmd) && existsSync('.git')) {
  let staged = [];
  try { staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean); } catch {}
  const badFiles = staged.filter(f => /(^|\/)\.env(?!\.example$)/.test(f) || /\.(pem|key|p12)$/.test(f) || /(^|\/)(\.next|coverage|playwright-report|test-results)\//.test(f));
  if (badFiles.length) block(`Staged files must not be committed: ${badFiles.join(', ')}`);
  let diff = '';
  try { diff = execSync('git diff --cached -U0', { encoding: 'utf8', maxBuffer: 20e6 }); } catch {}
  const secretRes = [/sk_(live|test)_[A-Za-z0-9]{16,}/, /whsec_[A-Za-z0-9]{16,}/, /re_[A-Za-z0-9]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /postgres(ql)?:\/\/[^\s:]+:[^\s@]{6,}@(?!localhost|127\.0\.0\.1)/];
  for (const re of secretRes) if (re.test(diff)) block(`Possible secret in staged changes (${re}). Remove it and use env vars.`);
  const piiLog = diff.split('\n').filter(l => l.startsWith('+') && /console\.(log|info|debug)\(/.test(l) && /(medical|medication|allerg|behaviour|bite|phone|email|address|card|password)/i.test(l));
  if (piiLog.length) block('Staged console logging near personal/sensitive fields. Remove or use the redacting logger.');
  try { execSync('command -v gitleaks', { stdio: 'ignore' }); execSync('gitleaks protect --staged --no-banner', { stdio: 'pipe' }); }
  catch (e) { if (e?.status === 1) block('gitleaks found a potential secret in staged changes.'); }
}
process.exit(0);
