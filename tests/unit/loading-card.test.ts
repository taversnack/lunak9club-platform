import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoadingCard } from '@/ui/loading-card';
import AccountLoading from '@/app/account/loading';
import AdminLoading from '@/app/admin/loading';

describe('loading placeholders', () => {
  it('announce themselves to screen readers and hide the decorative bars', () => {
    for (const C of [LoadingCard, AccountLoading, AdminLoading]) {
      const html = renderToStaticMarkup(createElement(C));
      expect(html).toContain('role="status"');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain('Loading…');
      expect(html).toContain('aria-hidden="true"');
    }
  });
});
