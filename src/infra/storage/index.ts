import { env } from '../env';
import { FsStorageProvider } from './fs';
import { S3StorageProvider } from './s3';
import type { StorageProvider } from './types';

let provider: StorageProvider | undefined;

export function getStorage(): StorageProvider {
  if (provider) return provider;
  const e = env();
  if (e.STORAGE_DRIVER === 's3') {
    if (!e.S3_ENDPOINT || !e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY) {
      throw new Error('STORAGE_DRIVER=s3 needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY');
    }
    provider = new S3StorageProvider({
      endpoint: e.S3_ENDPOINT,
      region: e.S3_REGION,
      bucket: e.S3_BUCKET,
      accessKeyId: e.S3_ACCESS_KEY_ID,
      secretAccessKey: e.S3_SECRET_ACCESS_KEY,
      forcePathStyle: e.S3_FORCE_PATH_STYLE === '1',
      publicEndpoint: e.S3_PUBLIC_ENDPOINT,
    });
  } else {
    provider = new FsStorageProvider(e.STORAGE_DIR);
  }
  return provider;
}

export function setStorage(p: StorageProvider | undefined): void {
  provider = p;
}

export type { StorageProvider } from './types';
