/**
 * Run database reads one after another. Use this instead of `Promise.all` whenever the reads may
 * run on a transaction (or any single connection): a connection runs one query at a time, and
 * queueing several on it is deprecated in `pg` 8 and an error from `pg` 9. Pass each read as a
 * function so it starts only when its turn comes.
 */
export async function inSequence<T extends readonly (() => PromiseLike<unknown>)[]>(
  ...steps: T
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const step of steps) out.push(await step());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
