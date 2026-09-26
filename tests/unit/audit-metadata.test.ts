import { describe, expect, it } from 'vitest';
import { sanitiseMetadata } from '@/server/audit';

describe('sanitiseMetadata', () => {
  it('drops keys that could hold personal or sensitive data', () => {
    const out = sanitiseMetadata({
      role: 'owner',
      email: 'x@example.test',
      customerName: 'Casey',
      phone: '0700',
      medicalNotes: 'x',
      resetToken: 't',
      count: 3,
    });
    expect(out).toEqual({ role: 'owner', count: 3 });
  });

  it('truncates long strings', () => {
    expect(String(sanitiseMetadata({ reason: 'a'.repeat(500) }).reason).length).toBe(200);
  });
});
