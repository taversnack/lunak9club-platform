// Shared helpers for LunaK9 Club hooks. Hooks must be fast and never irreversible.
export async function readInput() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try { return JSON.parse(data || '{}'); } catch { return {}; }
}
export function block(reason) {
  process.stderr.write(`[lunak9 guard] ${reason}\n`);
  process.exit(2); // exit 2 = block and show reason to Claude
}
