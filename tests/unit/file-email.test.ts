import { describe, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileEmailProvider } from '@/infra/email/providers';

describe('FileEmailProvider (test mail transport)', () => {
  it('leaves only finished .json files, named so they sort in send order', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lunak9-mail-'));
    const p = new FileEmailProvider(dir);
    const msg = (n: number) => ({
      to: 'a@example.test',
      template: 't',
      subject: `s${n}`,
      text: `t${n}`,
      html: `h${n}`,
    });
    await Promise.all(Array.from({ length: 20 }, (_, n) => p.send(msg(n))));
    await p.send(msg(99));
    const files = readdirSync(dir).sort();
    expect(files).toHaveLength(21);
    expect(files.every((f) => f.endsWith('.json'))).toBe(true); // no .tmp left behind
    const last = JSON.parse(readFileSync(join(dir, files.at(-1)!), 'utf8')) as { subject: string };
    expect(last.subject).toBe('s99');
  });
});
