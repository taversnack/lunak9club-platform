import { describe, expect, it } from 'vitest';
import { csvCell } from '@/server/csv';

describe('csvCell', () => {
  it('leaves plain numbers, including negative amounts, as numbers', () => {
    for (const n of ['-5.00', '-5', '0.00', '12.50', '-0.01']) expect(csvCell(n)).toBe(n);
    expect(csvCell(-5)).toBe('-5');
  });

  it('still neutralises anything that could run as a formula', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('-5.00+cmd')).toBe("'-5.00+cmd");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('-1,2')).toBe(`"'-1,2"`);
  });
});
