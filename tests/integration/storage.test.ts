import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { FsStorageProvider } from '@/infra/storage/fs';
import { S3StorageProvider } from '@/infra/storage/s3';

const data = new TextEncoder().encode('%PDF-1.7 hello');

describe('filesystem storage', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lunak9-fs-'));
  const fs = new FsStorageProvider(dir);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips a file and deletes it', async () => {
    await fs.put('customers/a/dogs/b/c', data, 'application/pdf');
    expect(new TextDecoder().decode(await fs.get('customers/a/dogs/b/c'))).toBe('%PDF-1.7 hello');
    expect(await fs.signedDownloadUrl()).toBeNull();
    await fs.delete('customers/a/dogs/b/c');
    await expect(fs.get('customers/a/dogs/b/c')).rejects.toThrow();
  });

  it('refuses keys that could escape the storage folder', async () => {
    await expect(fs.put('../escape', data, 'application/pdf')).rejects.toThrow(/Invalid storage key/);
    await expect(fs.get('/etc/passwd')).rejects.toThrow(/Invalid storage key/);
  });

  it('never overwrites an existing object', async () => {
    await fs.put('k/once', data, 'application/pdf');
    await expect(fs.put('k/once', data, 'application/pdf')).rejects.toThrow();
  });
});

// S3 adapter against a local S3-compatible server (moto). Needs `moto_server` on PATH (or
// MOTO_SERVER_BIN pointing at it); nothing installs it, so the suite is skipped when it's missing.
const MOTO = process.env.MOTO_SERVER_BIN ?? 'moto_server';

function isExecutable(bin: string): boolean {
  const candidates = bin.includes('/') ? [bin] : (process.env.PATH ?? '').split(delimiter).map((d) => join(d, bin));
  return candidates.some((file) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

describe.skipIf(!isExecutable(MOTO))('S3 storage', () => {
  let proc: ChildProcess | undefined;
  let available = false;

  beforeAll(async () => {
    let failed = false;
    proc = spawn(MOTO, ['-p', '5055'], { stdio: 'ignore' });
    // Spawn failures arrive as an async 'error' event; without a listener they become uncaught.
    proc.on('error', () => (failed = true));
    for (let i = 0; i < 40 && !failed; i++) {
      try {
        await fetch('http://127.0.0.1:5055/');
        available = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  });
  afterAll(() => proc?.kill());

  it('round-trips a file and issues a short-lived signed URL', async (ctx) => {
    if (!available) ctx.skip();
    const cfg = {
      endpoint: 'http://127.0.0.1:5055',
      region: 'eu-west-2',
      bucket: 'lunak9-test',
      accessKeyId: 'x',
      secretAccessKey: 'y',
      forcePathStyle: true,
    };
    await new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId: 'x', secretAccessKey: 'y' },
    }).send(
      new CreateBucketCommand({ Bucket: cfg.bucket, CreateBucketConfiguration: { LocationConstraint: 'eu-west-2' } }),
    );
    const s3 = new S3StorageProvider(cfg);
    await s3.put('customers/a/doc', data, 'application/pdf');
    expect(new TextDecoder().decode(await s3.get('customers/a/doc'))).toBe('%PDF-1.7 hello');
    const url = await s3.signedDownloadUrl('customers/a/doc', {
      expiresInSeconds: 60,
      filename: 'vacc "card".pdf',
      contentType: 'application/pdf',
    });
    expect(url).toMatch(/X-Amz-Expires=60/);
    const res = await fetch(url!);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('vacc _card_.pdf');
    await s3.delete('customers/a/doc');
    await expect(s3.get('customers/a/doc')).rejects.toThrow();
  });
});
