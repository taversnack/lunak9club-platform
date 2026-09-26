import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './types';

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Browser-facing endpoint for signed URLs if it differs from the server-side one. */
  publicEndpoint?: string;
};

/** S3-compatible storage (MinIO locally, Cloudflare R2 in production). Bucket must be private. */
export class S3StorageProvider implements StorageProvider {
  readonly name = 's3' as const;
  private readonly client: S3Client;
  private readonly signer: S3Client;

  constructor(private readonly cfg: S3Config) {
    const base = {
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    };
    this.client = new S3Client({ ...base, endpoint: cfg.endpoint });
    this.signer = new S3Client({ ...base, endpoint: cfg.publicEndpoint ?? cfg.endpoint });
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, sizeBytes: body.byteLength };
  }

  async get(key: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!res.Body) throw new Error('Empty object');
    return new Uint8Array(await res.Body.transformToByteArray());
  }

  async signedDownloadUrl(key: string, opts: { expiresInSeconds: number; filename: string; contentType: string }) {
    const safeName = opts.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 100) || 'document';
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        ResponseContentType: opts.contentType,
        ResponseContentDisposition: `inline; filename="${safeName}"`,
      }),
      { expiresIn: opts.expiresInSeconds },
    );
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}
