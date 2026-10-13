import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ActionForm } from '@/ui/form';

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pages(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

describe('ActionForm (server-action forms)', () => {
  it('renders a file-upload form without the React encType/method warning', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const action = async () => ({ status: 'idle' as const });
    const html = renderToString(
      // eslint-disable-next-line react/no-children-prop -- plain createElement call in a .ts test
      createElement(ActionForm, { action, children: createElement('input', { type: 'file', name: 'f' }) }),
    );
    const warned = errors.mock.calls.some((c) => String(c[0]).includes('encType or method'));
    errors.mockRestore();
    expect(warned).toBe(false);
    expect(html).toContain('type="file"');
  });

  it('no page passes encType or method to a server-action form (React sets them itself)', () => {
    const offenders = pages('src/app').filter((f) =>
      /<ActionForm[^>]*\b(encType|method)=/.test(readFileSync(f, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
