import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { incidentMessage, vaccinationReminderMessage, welfareNoteMessage } from '@/infra/email/templates';
import { CONCERN_LABELS, concernsToList, welfareConcerns } from '@/domain/compliance/welfare';

describe('email subjects keep the dog’s name as written (Tester phase 7, #6)', () => {
  it('vaccination expired', () => {
    const m = vaccinationReminderMessage(
      'a@b.test',
      'Casey',
      { dogName: 'Biscuit', expired: true, dateText: '1 Oct' },
      'u',
    );
    expect(m.subject).toContain('Biscuit');
    expect(m.subject).not.toContain('biscuit');
  });
  it('welfare note', () => {
    const m = welfareNoteMessage('a@b.test', 'Casey', 'Biscuit', 'today', 'u');
    expect(m.subject).toContain('Biscuit');
    expect(m.subject).not.toContain('biscuit');
  });
});

describe('incident and welfare emails use the real day (#8)', () => {
  it('says the date, not “today”, for an earlier day', () => {
    const i = incidentMessage(
      'a@b.test',
      'Casey',
      { dogName: 'Biscuit', update: false, dayText: 'on 2 October 2026' },
      'u',
    );
    expect(i.subject).toContain('on 2 October 2026');
    expect(i.subject).not.toContain('today');
    const w = welfareNoteMessage('a@b.test', 'Casey', 'Biscuit', 'on 2 October 2026', 'u');
    expect(w.subject + w.text).toContain('on 2 October 2026');
    expect(w.subject + w.text).not.toContain('today');
  });
});

describe('daily note lists “Drinking more than usual” once (#7)', () => {
  it('drops drinking concerns already shown by the drinking label', () => {
    const { concerns } = welfareConcerns('more', ['stress']);
    const listed = concernsToList(concerns).map((c) => CONCERN_LABELS[c]);
    expect(listed).toEqual(['Signs of stress']);
  });
});

describe('pnpm verify runs Next typegen before typecheck (#5)', () => {
  it('orders the steps', () => {
    const src = readFileSync('scripts/verify.ts', 'utf8');
    const gen = src.indexOf('next typegen');
    expect(gen).toBeGreaterThan(-1);
    expect(gen).toBeLessThan(src.indexOf("'pnpm -s typecheck'"));
  });
});

describe('Playwright config (#10)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
  });
  async function load() {
    vi.resetModules();
    const cfg = (await import('../../playwright.config')).default;
    return cfg.webServer as { url: string; reuseExistingServer: boolean; command: string };
  }
  it('uses E2E_PORT, defaulting to 3100', async () => {
    process.env.E2E_PORT = '3999';
    expect((await load()).url).toContain(':3999/');
    delete process.env.E2E_PORT;
    expect((await load()).url).toContain(':3100/');
  });
  it('never reuses an existing server unless local dev opts in', async () => {
    delete process.env.CI;
    delete process.env.E2E_REUSE_SERVER;
    expect((await load()).reuseExistingServer).toBe(false);
    process.env.E2E_REUSE_SERVER = '1';
    expect((await load()).reuseExistingServer).toBe(true);
    process.env.CI = '1';
    expect((await load()).reuseExistingServer).toBe(false);
  });
});
