import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isIsoDate, londonDate } from '@/domain/time';
import { checkUpload, safeDisplayName, sniffFileType, MAX_UPLOAD_BYTES } from '@/domain/documents/file-type';

describe('London dates', () => {
  it('uses the London calendar date around midnight in summer time', () => {
    expect(londonDate(new Date('2026-06-30T23:30:00Z'))).toBe('2026-07-01');
    expect(londonDate(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });
  it('handles the clocks going back', () => {
    expect(londonDate(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25');
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('validates ISO dates strictly', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('26/09/2026')).toBe(false);
    expect(isIsoDate('2026-09-26')).toBe(true);
  });
});

const bytes = (...xs: (number | string)[]) => {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === 'string') out.push(...[...x].map((c) => c.charCodeAt(0)));
    else out.push(x);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
};

describe('upload checks', () => {
  it('recognises allowed types from their contents', () => {
    expect(sniffFileType(bytes('%PDF-1.7'))?.mime).toBe('application/pdf');
    expect(sniffFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe('image/jpeg');
    expect(sniffFileType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))?.mime).toBe('image/png');
    expect(sniffFileType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))?.mime).toBe('image/webp');
    expect(sniffFileType(bytes(0, 0, 0, 0x18, 'ftypheic'))?.mime).toBe('image/heic');
  });
  it('rejects disguised or unsupported files', () => {
    expect(checkUpload(bytes('<html><script>')).ok).toBe(false);
    expect(checkUpload(bytes('MZ', 0x90))).toMatchObject({ ok: false });
    expect(checkUpload(new Uint8Array())).toMatchObject({ ok: false, message: 'The file is empty.' });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(checkUpload(big)).toMatchObject({ ok: false, message: 'The file is larger than 10 MB.' });
  });
  it('makes display names harmless', () => {
    expect(safeDisplayName('../../etc/passwd')).not.toContain('/');
    expect(safeDisplayName('<img src=x>.pdf')).not.toContain('<');
    expect(safeDisplayName('')).toBe('document');
  });
});
