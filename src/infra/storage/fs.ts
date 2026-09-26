import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { StorageProvider } from './types';

/** Local filesystem storage for development. Files are only served through the app after a permission check. */
export class FsStorageProvider implements StorageProvider {
  readonly name = 'fs' as const;
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string): string {
    if (!/^[a-z0-9/_-]+$/i.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root + sep)) throw new Error('Invalid storage key');
    return p;
  }

  async put(key: string, body: Uint8Array, _contentType: string) {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, { flag: 'wx', mode: 0o600 });
    return { key, sizeBytes: body.byteLength };
  }

  async get(key: string) {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async signedDownloadUrl() {
    return null;
  }

  async delete(key: string) {
    await rm(this.pathFor(key), { force: true });
  }
}
