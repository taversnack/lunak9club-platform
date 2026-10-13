import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Drizzle's migrator only applies entries whose `when` is later than the last applied one,
// so an out-of-order timestamp makes it silently skip a migration. Guard the journal and chain.
const dir = join(process.cwd(), 'drizzle');
const journal = JSON.parse(readFileSync(join(dir, 'meta', '_journal.json'), 'utf8')) as {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};
const entries = journal.entries;

describe('drizzle migration journal', () => {
  it('has strictly increasing `when` values', () => {
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].when, `${entries[i].tag} must be later than ${entries[i - 1].tag}`).toBeGreaterThan(
        entries[i - 1].when,
      );
    }
  });

  it('has idx matching the tag number, in increasing order', () => {
    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].idx).toBe(Number(entries[i].tag.slice(0, 4)));
      if (i > 0) expect(entries[i].idx).toBeGreaterThan(entries[i - 1].idx);
      expect(entries[i].breakpoints).toBe(true);
    }
  });

  it('lists every SQL file exactly once', () => {
    const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort();
    expect(entries.map((e) => e.tag)).toEqual(sql);
  });

  it('chains snapshot prevIds in journal order', () => {
    const snaps = entries.map((e) => JSON.parse(readFileSync(join(dir, 'meta', `${e.tag.slice(0, 4)}_snapshot.json`), 'utf8')));
    for (let i = 1; i < snaps.length; i++) {
      expect(snaps[i].prevId, `${entries[i].tag} prevId`).toBe(snaps[i - 1].id);
    }
  });
});
