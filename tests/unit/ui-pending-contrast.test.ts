import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PendingButton } from '@/ui/form';

describe('PendingButton', () => {
  it('shows a spinner, pending text and aria-busy when pending is passed', () => {
    const out = renderToStaticMarkup(
      h(PendingButton, { pending: true, pendingText: 'Signing in…', full: true, children: 'Sign in' }),
    );
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('disabled');
    expect(out).toContain('Signing in…');
    expect(out).toMatch(/<span[^>]*aria-hidden="true"/);
  });

  it('is a plain submit button when not pending', () => {
    const out = renderToStaticMarkup(h(PendingButton, { pending: false, children: 'Sign in' }));
    expect(out).not.toContain('aria-busy');
    expect(out).not.toContain('disabled');
    expect(out).toContain('>Sign in</button>');
  });
});

// WCAG 1.4.11: boundaries that identify controls or states need 3:1 against what's next to them.
const css = readFileSync('src/app/globals.css', 'utf8');
const token = (name: string) => {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css);
  if (!m) throw new Error(`missing token ${name}`);
  return m[1]!;
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = c.map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [x = 0, y = 0] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('border tokens', () => {
  it('the strong border reaches 3:1 on surface, page background and muted surface', () => {
    for (const bg of ['color-surface', 'color-bg', 'color-surface-muted'])
      expect(ratio(token('color-border-strong'), token(bg))).toBeGreaterThanOrEqual(3);
  });
  it('each state border reaches 3:1 against its own tint and white', () => {
    for (const t of ['success', 'warning', 'danger', 'info']) {
      expect(ratio(token(`color-${t}-border`), token(`color-${t}-bg`))).toBeGreaterThanOrEqual(3);
      expect(ratio(token(`color-${t}-border`), token('color-surface'))).toBeGreaterThanOrEqual(3);
    }
  });
});
