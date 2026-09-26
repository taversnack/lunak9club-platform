// PostToolUse(Edit|Write): format + lint the edited TS file and run related unit tests.
// Reports problems to Claude but never blocks or modifies anything except formatting.
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readInput } from './lib.mjs';

const input = await readInput();
const file = String(input?.tool_input?.file_path ?? '');
if (!/\.(ts|tsx|mts)$/.test(file) || !existsSync('node_modules')) process.exit(0);

const run = (c, t) => { try { execSync(c, { stdio: 'pipe', timeout: t }); return null; } catch (e) { return String(e.stdout || e.stderr || e.message).slice(0, 2000); } };
const q = JSON.stringify(file);
const problems = [];
run(`pnpm exec prettier --write ${q}`, 15000);
const lint = run(`pnpm exec eslint --fix ${q}`, 20000); if (lint) problems.push(`ESLint:\n${lint}`);
if (/\/src\/domain\//.test(file)) { const t = run(`pnpm exec vitest related --run ${q}`, 30000); if (t) problems.push(`Related tests:\n${t}`); }
if (problems.length) { process.stderr.write(problems.join('\n\n')); process.exit(2); }
process.exit(0);
