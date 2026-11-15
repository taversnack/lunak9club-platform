import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  existingTablesProblem,
  invoiceNumberingCheck,
  migrationCountProblem,
  missingDumpProblem,
  restoreTargetProblem,
} from '@/infra/db/restore-drill-checks';
import { assertNotProduction, assertSafeDatabaseUrl } from '../../scripts/_env';

describe('restore drill refusals', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses in a production environment, whatever else is set', () => {
    vi.stubEnv('APP_ENV', 'production');
    expect(() => assertNotProduction('run a restore drill')).toThrow(/production/);
    vi.unstubAllEnvs();
    vi.stubEnv('APP_ENV', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertNotProduction('run a restore drill')).toThrow(/production/);
    vi.stubEnv('NODE_ENV', 'test');
    expect(() => assertNotProduction('run a restore drill')).not.toThrow();
  });

  it('refuses a non-local database host unless the name is a test database', () => {
    vi.stubEnv('ALLOW_REMOTE_DB', '');
    expect(() => assertSafeDatabaseUrl('postgres://u:p@db.example.com:5432/lunak9')).toThrow(/non-local/);
    expect(() => assertSafeDatabaseUrl(undefined)).toThrow(/DATABASE_URL/);
    expect(() => assertSafeDatabaseUrl('postgres://u:p@localhost:5432/lunak9_dev')).not.toThrow();
  });

  it('refuses a target equal to the source', () => {
    expect(restoreTargetProblem('lunak9_x_test', 'lunak9_x_test')).toMatch(/must not be the database/);
  });

  it.each(['lunak9', 'production', 'attest', 'lunak9_latest_db', 'testing'])(
    'refuses target name %s without a "test" word',
    (name) => {
      expect(restoreTargetProblem('lunak9_dev', name)).toMatch(/must contain "test"/);
    },
  );

  it.each(['Lunak9_Test', 'x; something_test', 'a-test', 'a test', ''])(
    'refuses unsafe target name %j (only lowercase letters, digits, underscores reach SQL)',
    (name) => {
      expect(restoreTargetProblem('lunak9_dev', name)).toMatch(/lowercase letters, digits and underscores/);
    },
  );

  it.each(['lunak9_restore_test', 'test_copy', 'lunak9_backend_restore2_test'])('accepts %s', (name) => {
    expect(restoreTargetProblem('lunak9_dev', name)).toBeNull();
  });

  it('refuses a target that already has tables, and accepts an empty one', () => {
    expect(existingTablesProblem('t_test', 3)).toMatch(/already has tables.*never overwrites/);
    expect(existingTablesProblem('t_test', 0)).toBeNull();
  });

  it('refuses a missing dump', () => {
    expect(missingDumpProblem('/x/y.dump', false)).toBe('No dump at /x/y.dump.');
    expect(missingDumpProblem('/x/y.dump', true)).toBeNull();
  });
});

describe('restore drill checks', () => {
  it('migration count must equal the code journal', () => {
    expect(migrationCountProblem(24, 24)).toBeNull();
    expect(migrationCountProblem(23, 24)).toMatch(/23 applied, the code has 24/);
    expect(migrationCountProblem(25, 24)).not.toBeNull();
  });

  it('invoice numbers: gap-free and equal to the sequence passes (order does not matter)', () => {
    expect(invoiceNumberingCheck([], 1)).toEqual({ label: 'gap-free', problem: null });
    expect(invoiceNumberingCheck(['LK9-03', 'LK9-01', 'LK9-02'], 4)).toEqual({ label: 'gap-free', problem: null });
  });

  it('invoice numbers: a gap is a problem', () => {
    const r = invoiceNumberingCheck(['LK9-01', 'LK9-03', 'LK9-04'], 4);
    expect(r.label).toBe('GAPS');
    expect(r.problem).toMatch(/without gaps/);
  });

  it('invoice numbers: count must agree with the sequence', () => {
    const r = invoiceNumberingCheck(['LK9-01', 'LK9-02'], 4);
    expect(r.label).toBe('COUNT MISMATCH');
    expect(r.problem).toMatch(/2 numbered invoices but the sequence says 3/);
    expect(invoiceNumberingCheck(['LK9-01', 'LK9-02'], 2).problem).not.toBeNull();
  });

  it('invoice numbers: several prefixes (test data only) skip the suffix check but not the count', () => {
    expect(invoiceNumberingCheck(['A-01', 'B-01'], 3).problem).toBeNull();
    expect(invoiceNumberingCheck(['A-01', 'B-01'], 5).problem).not.toBeNull();
  });
});

describe('restore drill script safety (source guard)', () => {
  const src = readFileSync('scripts/restore-drill.ts', 'utf8');
  it('calls the guards and keeps to CREATE DATABASE and reads', () => {
    expect(src).toContain("assertNotProduction('run a restore drill')");
    expect(src).toContain('assertSafeDatabaseUrl');
    expect(src).toContain('restoreTargetProblem');
    expect(src).toContain('existingTablesProblem');
    expect(src).not.toMatch(/\b(DR[O]P|TRUNCATE)\b|\bDELETE\s+FROM\b/i);
    expect(src).not.toMatch(/pg_restore[^\n]*(--clean|--create)/);
  });
});
