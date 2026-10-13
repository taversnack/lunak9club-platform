import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import type { Route } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, DataTable, EmptyState, PageHeader, StatCard, StatusBadge, SubNav, buttonClass } from '@/ui/components';

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe('shared UI components', () => {
  it('Button keeps its existing API and adds danger/sm without breaking defaults', () => {
    expect(html(h(Button, { type: 'submit' }, 'Save'))).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
    expect(html(h(Button, { variant: 'danger', size: 'sm' }, 'Delete'))).toContain('Delete');
    expect(typeof buttonClass()).toBe('string');
    expect(typeof buttonClass('secondary', true, 'sm')).toBe('string');
  });

  it('PageHeader renders a single h1 and optional actions', () => {
    const out = html(h(PageHeader, { title: 'Bookings', lead: 'Your days', actions: h('a', { href: '/x' }, 'Book') }));
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain('Your days');
    expect(out).toContain('href="/x"');
  });

  it('StatCard labels its section by its heading', () => {
    const out = html(
      h(StatCard, {
        label: 'Upcoming bookings',
        value: '£120.00',
        href: '/admin/bookings' as Route,
        linkText: 'See bookings',
      }),
    );
    expect(out).toContain('aria-labelledby="stat-upcoming-bookings"');
    expect(out).toMatch(/<h2 id="stat-upcoming-bookings"/);
    expect(out).toContain('£120.00');
    expect(out).toContain('See bookings');
  });

  it('StatCard can use h3 for nested outlines', () => {
    expect(html(h(StatCard, { label: 'X', value: 1, headingLevel: 3 }))).toContain('<h3');
  });

  it('EmptyState announces politely and shows an action', () => {
    const out = html(
      h(EmptyState, { title: 'No bookings yet', action: h('a', { href: '/account/book' }, 'Book day care') }),
    );
    expect(out).toContain('role="status"');
    expect(out).toContain('No bookings yet');
    expect(out).toContain('Book day care');
  });

  it('DataTable always has a caption and a focusable labelled scroll region', () => {
    const out = html(h(DataTable, { caption: 'Invoices', captionHidden: true, children: h('tbody') }));
    expect(out).toContain('<caption class="visually-hidden">Invoices</caption>');
    expect(out).toContain('role="region"');
    expect(out).toContain('aria-label="Invoices"');
    expect(out).toContain('tabindex="0"');
  });

  it('SubNav marks the current page with aria-current', () => {
    const out = html(
      h(SubNav, {
        label: 'Account',
        current: '/account/bookings',
        items: [
          { href: '/account' as Route, label: 'Overview' },
          { href: '/account/bookings' as Route, label: 'Bookings' },
        ],
      }),
    );
    expect(out).toContain('aria-label="Account"');
    expect(out.match(/aria-current="page"/g)).toHaveLength(1);
    expect(out).toMatch(/aria-current="page" href="\/account\/bookings"/);
  });

  it('StatusBadge shows an icon and text, never colour alone', () => {
    const out = html(h(StatusBadge, { tone: 'success', children: 'Approved' }));
    expect(out).toContain('<svg');
    expect(out).toContain('Approved');
  });
});

describe('refresh components', () => {
  it('Disclosure uses details/summary', async () => {
    const { Disclosure } = await import('@/ui/components');
    const out = html(h(Disclosure, { title: 'Health', children: 'x' }));
    expect(out).toMatch(/<details[^>]*><summary>Health<\/summary>/);
  });
  it('ErrorSummary links to fields and is an alert; renders nothing without errors', async () => {
    const { ErrorSummary } = await import('@/ui/components');
    const out = html(
      h(ErrorSummary, { errors: [{ field: 'date', message: 'Choose a date' }, { message: 'General' }] }),
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain('href="#f-date"');
    expect(html(h(ErrorSummary, { errors: [] }))).toBe('');
  });
  it('PageSkeleton announces loading and hides shapes from assistive tech', async () => {
    const { PageSkeleton } = await import('@/ui/components');
    const out = html(h(PageSkeleton, {}));
    expect(out).toContain('role="status"');
    expect(out).toContain('Loading…');
    expect(out).toContain('aria-hidden="true"');
  });
  it('DateCard gives screen readers the date in words', async () => {
    const { DateCard } = await import('@/ui/components');
    const out = html(h(DateCard, { date: '2026-10-16', title: 'Biscuit · Full day' }));
    expect(out).toContain('Fri 16 Oct');
    expect(out).toContain('Biscuit · Full day');
  });
  it('DataTable stack mode keeps caption and region', async () => {
    const { DataTable } = await import('@/ui/components');
    const out = html(h(DataTable, { caption: 'Bookings', stack: true, children: h('tbody') }));
    expect(out).toContain('<caption');
    expect(out).toContain('role="region"');
  });
});
