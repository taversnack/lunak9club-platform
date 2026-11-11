import { describe, expect, it } from 'vitest';
import { auditLeaks } from '../support/audit-scan';

const NEEDLES = ['07700', 'Biscuit'];
// A random-looking id that happens to contain 07700.
const UNLUCKY_ID = '3f07700a-0738-4237-b675-9b8c70060fc4';

describe('auditLeaks', () => {
  it('ignores a UUID that happens to contain 07700 (the old check failed on it)', () => {
    const rows = [{ action: 'dog.created', metadata: { dogId: UNLUCKY_ID, vaccinations: 3 } }];
    expect(JSON.stringify(rows)).toContain('07700'); // the old check
    expect(auditLeaks(rows, NEEDLES)).toEqual([]);
  });

  it('still finds a real phone number or name, and names only the action and key', () => {
    const rows = [
      { action: 'dog.created', metadata: { dogId: UNLUCKY_ID } },
      { action: 'document.uploaded', metadata: { dogId: UNLUCKY_ID, label: 'Call 07700 900123' } },
      { action: 'dog.vet_saved', metadata: { x: 'Biscuit' } },
    ];
    expect(auditLeaks(rows, NEEDLES)).toEqual(['document.uploaded.label', 'dog.vet_saved.x']);
  });
});
