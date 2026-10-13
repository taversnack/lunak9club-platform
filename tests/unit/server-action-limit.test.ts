import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { MAX_INCIDENT_PHOTOS, MAX_UPLOAD_BYTES } from '@/domain/documents/file-type';

const toBytes = (limit: string | number | undefined) => {
  if (typeof limit === 'number') return limit;
  const m = /^(\d+(?:\.\d+)?)(b|kb|mb|gb)$/i.exec(limit ?? '1mb'); // Next's default is 1 MB
  if (!m) throw new Error(`Unrecognised size ${limit}`);
  return Number(m[1]) * 1024 ** ['b', 'kb', 'mb', 'gb'].indexOf(m[2]!.toLowerCase());
};

describe('Server Action body limit (review L4)', () => {
  it('fits an incident report with every photo at the largest size the app allows', () => {
    const limit = toBytes(nextConfig.experimental?.serverActions?.bodySizeLimit);
    const MB = 1024 * 1024;
    // The incident form promises "up to 5 photos or PDFs, 10 MB each"; leave at least 1 MB for the
    // other fields and multipart overhead.
    expect(limit).toBeGreaterThanOrEqual(5 * 10 * MB + MB);
    // And it stays in step with the limits the service enforces.
    expect(limit).toBeGreaterThanOrEqual(MAX_INCIDENT_PHOTOS * MAX_UPLOAD_BYTES + MB);
  });
});
