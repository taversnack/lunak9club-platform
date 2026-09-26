// Stop: if source files changed since the last `pnpm verify`, ask for an evidence-based
// verification summary before finishing. `pnpm verify` touches .claude/.last-verify.
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readInput } from './lib.mjs';

const input = await readInput();
if (input?.stop_hook_active) process.exit(0); // avoid loops
const marker = '.claude/.last-verify';
const since = existsSync(marker) ? statSync(marker).mtimeMs : 0;
const roots = ['src', 'tests', 'drizzle'].filter(existsSync);
let changed = false;
const walk = d => { for (const n of readdirSync(d)) { if (changed || n === 'node_modules') return; const p = join(d, n); const s = statSync(p); if (s.isDirectory()) walk(p); else if (s.mtimeMs > since) changed = true; } };
roots.forEach(walk);
if (changed) {
  process.stderr.write('Source changed since the last `pnpm verify`. Before finishing, run the relevant checks and give a verification summary: commands run, results, failures and limitations. If checks cannot run, say so explicitly.');
  process.exit(2);
}
process.exit(0);
