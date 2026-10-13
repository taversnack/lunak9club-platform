import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { VaccineChoice } from '@/ui/vaccine-choice';

describe('vaccination upload: one vaccine row', () => {
  it('asks for no dates (and requires none) until the vaccine is ticked', () => {
    const html = renderToString(
      createElement(VaccineChoice, { vaccineKey: 'lepto', label: 'Lepto', today: '2026-10-13' }),
    );
    expect(html).toContain('name="covers"');
    expect(html).not.toContain('administeredOn.lepto');
    expect(html).not.toContain('expiresOn.lepto');
    expect(html).not.toContain('required');
  });
});
