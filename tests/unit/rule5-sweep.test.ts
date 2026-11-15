/**
 * Rule 5 sweep (CLAUDE.md): no medical, behavioural, payment, auth or contact data in logs, errors, analytics or
 * email bodies. This scans the source for the patterns that could carry it. A new hit fails the test: fix the code,
 * or, if the use is deliberate and has been looked at, add it to an allowlist below WITH the reason. The scanner is
 * itself tested on made-up snippets so it can't quietly stop seeing anything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(dir = 'src'): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

const lineOf = (src: string, pos: number) => src.slice(0, pos).split('\n').length;

/** The text of a call from its opening parenthesis to the matching closing one. */
function callText(src: string, openParenEnd: number): string {
  let depth = 1;
  let i = openParenEnd;
  while (i < src.length && depth) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') depth--;
    i++;
  }
  return src.slice(openParenEnd, i);
}

/** Plain quoted text is the fixed message (safe); what is left is what could carry data. */
const withoutPlainStrings = (s: string) =>
  s.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');

type Hit = { file: string; line: number; why: string; text: string };

/** Log and console calls: no error text, interpolation, serialisation or sensitive-named values. */
export function scanLogCalls(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of src.matchAll(/\b(?:logger|console)\.(?:fatal|error|warn|info|debug|log)\(/g)) {
    const text = callText(src, m.index! + m[0].length);
    const code = withoutPlainStrings(text);
    const add = (why: string) => hits.push({ file, line: lineOf(src, m.index!), why, text: text.slice(0, 120) });
    if (/\.message\b/.test(code))
      add('logs an error message (it can carry an address or other detail): log err.name only');
    if (/String\(\s*err/.test(code)) add('logs String(err): log err.name only');
    if (/JSON\.stringify|\.\.\./.test(code)) add('serialises or spreads an object into a log line');
    if (/\$\{/.test(code) && /`/.test(code)) add('interpolates a value into a log message');
    for (const e of code.matchAll(/\berr:\s*([^,}]+)/g))
      if (!/errName\(|\.name\b|^''\s*$/.test(e[1]!.trim())) add('the err field must be the error name only');
    if (/[{,]\s*err\s*[,}]/.test(code)) add('logs the whole error object (shorthand err): log err.name only');
    if (
      /\b(email|phone|password|passwd|token|secret|address|postcode|dogName|firstName|customerName|displayName|notes?|medical|vaccin\w*|behaviour|description|body|html|subject)\b/i.test(
        code,
      )
    )
      add('names a value that could be personal, medical, behavioural or payment data');
  }
  return hits;
}

/** Interpolations in email bodies that read from fields which could be medical, contact or free-text. */
export function scanEmailBodies(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  const bad =
    /vaccin|medical|behaviour|health|descri|notes?\b|phone|address|postcode|passw|reason|insur|microchip|weight|allerg|diagnos|dateOfBirth|breed|\bvet\b/i;
  for (const m of src.matchAll(/\$\{([^}]*)\}/g))
    if (bad.test(m[1]!) && !/^button\(/.test(m[1]!.trim()))
      hits.push({
        file,
        line: lineOf(src, m.index!),
        why: 'an email body reads a field that could carry sensitive data',
        text: m[1]!.trim().slice(0, 100),
      });
  return hits;
}

/** Error messages (they reach users, logs and tests) must not interpolate contact or secret values. */
export function scanErrorMessages(file: string, src: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of src.matchAll(/new\s+\w*Error\(/g)) {
    const text = callText(src, m.index! + m[0].length);
    for (const t of text.matchAll(/\$\{([^}]*)\}/g))
      if (
        /\b(email|phone|password|passwd|token|secret|address|postcode|sha256|storageKey|apiKey|webhookSecret)\b/i.test(
          t[1]!,
        )
      )
        hits.push({
          file,
          line: lineOf(src, m.index!),
          why: 'an error message interpolates a contact or secret value',
          text: text.slice(0, 120),
        });
  }
  return hits;
}

const show = (hits: Hit[]) => hits.map((h) => `${h.file}:${h.line} ${h.why}: ${h.text}`).join('\n');

/** Reviewed exceptions, each with the file, the offending text it covers and the reason. */
type Allowed = { file: string; contains: string; reason: string };
const allowed = (list: Allowed[]) => (h: Hit) => !list.some((a) => a.file === h.file && h.text.includes(a.contains));
const ALLOWED_EMAIL_FIELDS: Allowed[] = [
  // D56: the Owner declines a refund "with a reason" and the customer is emailed the decision. Owner-typed text.
  { file: 'src/infra/email/templates.ts', contains: 'd.reason', reason: 'D56 refund decision reason' },
  // Our own fixed erasure-blocker sentences ("you have upcoming bookings"), not free text (D65).
  { file: 'src/infra/email/templates.ts', contains: 'p.reason', reason: 'D65 closure blocker sentence' },
];
const ALLOWED_LOG_CALLS: Allowed[] = [
  // The startup refusal names the unsafe SETTINGS (never their values): see the production refusal check in tests/unit/env.test.ts.
  { file: 'src/instrumentation.ts', contains: 'Refusing to start', reason: 'startup refusal names settings only' },
];

describe('rule 5 sweep over src', () => {
  const files = sourceFiles();
  it('finds the files (the sweep is not scanning nothing)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('src/infra/email/templates.ts');
  });

  it('logs carry error names, ids and fixed messages only', () => {
    const hits = files.flatMap((f) => scanLogCalls(f, readFileSync(f, 'utf8'))).filter(allowed(ALLOWED_LOG_CALLS));
    expect(show(hits), 'a log line could carry personal data').toBe('');
  });

  it('email bodies read no sensitive-looking field beyond the reviewed ones', () => {
    const hits = scanEmailBodies(
      'src/infra/email/templates.ts',
      readFileSync('src/infra/email/templates.ts', 'utf8'),
    ).filter(allowed(ALLOWED_EMAIL_FIELDS));
    expect(show(hits)).toBe('');
  });

  it('error messages interpolate no contact or secret values', () => {
    const hits = files.flatMap((f) => scanErrorMessages(f, readFileSync(f, 'utf8')));
    expect(show(hits)).toBe('');
  });

  it('there is no console logging outside the reviewed startup refusal', () => {
    const using = files.filter((f) => /\bconsole\.(log|info|warn|error|debug)\(/.test(readFileSync(f, 'utf8')));
    expect(using).toEqual(['src/instrumentation.ts']);
  });
});

describe('the scanner itself', () => {
  it('flags the patterns it is meant to', () => {
    const bad = [
      "logger.error({ err: String(err) }, 'failed')",
      "logger.error({ err: err.message }, 'failed')",
      "logger.info({ email: user.email }, 'signed in')",
      'logger.warn(`could not send to ${to}`)',
      "logger.info({ ...customer }, 'x')",
      "logger.error({ err }, 'x')",
      "console.log('hi', dogName)",
    ];
    for (const b of bad) expect(scanLogCalls('x.ts', b), b).not.toHaveLength(0);
  });
  it('accepts the safe shapes', () => {
    const good = [
      "logger.error({ err: err instanceof Error ? err.name : 'unknown' }, 'job failed')",
      "logger.error({ job, err: errName(err) }, 'tick step failed')",
      "logger.warn({}, 'retention: file already gone')",
      "logger.info({ emailId: id, template: message.template }, 'email suppressed')",
    ];
    for (const g of good) expect(scanLogCalls('x.ts', g), g).toHaveLength(0);
  });
  it('flags a sensitive field in an email body and a contact value in an error message', () => {
    expect(scanEmailBodies('t.ts', 'const x = `Notes: ${p.healthNotes}`;')).toHaveLength(1);
    expect(scanEmailBodies('t.ts', "const x = `${button(url, 'Open')} hi ${firstName}`;")).toHaveLength(0);
    expect(scanErrorMessages('s.ts', 'throw new ConflictError(`No account for ${email}`);')).toHaveLength(1);
    expect(scanErrorMessages('s.ts', "throw new ConflictError('This link has expired.');")).toHaveLength(0);
  });
});
