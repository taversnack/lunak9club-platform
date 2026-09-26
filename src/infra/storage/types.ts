export type StoredObject = { key: string; sizeBytes: number };

export interface StorageProvider {
  readonly name: 's3' | 'fs';
  put(key: string, body: Uint8Array, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Uint8Array>;
  /** Short-lived URL for direct download, or null when the provider can't sign (stream via the app instead). */
  signedDownloadUrl(
    key: string,
    opts: { expiresInSeconds: number; filename: string; contentType: string },
  ): Promise<string | null>;
  delete(key: string): Promise<void>;
}
