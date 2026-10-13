import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Minimum versions that fix the high-severity advisories `pnpm audit --prod` reported (Oct 2026).
const version = (from: string, pkg: string) => {
  const req = createRequire(from);
  let dir = dirname(req.resolve(pkg));
  while (!dir.endsWith(pkg)) dir = dirname(dir);
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version as string;
};
const atLeast = (v: string, min: string) => {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
};
const root = join(process.cwd(), 'package.json');

describe('patched dependencies', () => {
  it('next >= 16.3.8 (image SSRF and others)', () => {
    expect(atLeast(version(root, 'next'), '16.3.8')).toBe(true);
  });
  it('sharp (used by next) >= 0.35.5 (librsvg)', () => {
    const nextPkg = createRequire(root).resolve('next/package.json');
    expect(atLeast(version(nextPkg, 'sharp'), '0.35.5')).toBe(true);
  });
  it('source-map-js (used by postcss) >= 1.2.2 (event-loop DoS)', () => {
    const postcss = createRequire(createRequire(root).resolve('next/package.json')).resolve('postcss/package.json');
    expect(atLeast(version(postcss, 'source-map-js'), '1.2.2')).toBe(true);
  });
});
