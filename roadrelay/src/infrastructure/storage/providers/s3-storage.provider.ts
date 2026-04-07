import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  IStorageProvider,
  PresignedDownload,
  PresignedDownloadInput,
  PresignedUpload,
  PresignedUploadInput,
} from '../tokens';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  presignTtl: number;
}

export class S3StorageProvider implements IStorageProvider {
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: !!opts.endpoint,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
    });
  }

  bucket(): string {
    return this.opts.bucket;
  }

  async presignUpload(input: PresignedUploadInput): Promise<PresignedUpload> {
    const cmd = new PutObjectCommand({
      Bucket: this.opts.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.maxBytes,
      ServerSideEncryption: 'AES256',
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: this.opts.presignTtl });
    return {
      url,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType },
      expiresAt: new Date(Date.now() + this.opts.presignTtl * 1000),
    };
  }

  async presignDownload(input: PresignedDownloadInput): Promise<PresignedDownload> {
    const cmd = new GetObjectCommand({
      Bucket: this.opts.bucket,
      Key: input.key,
      ResponseContentDisposition: input.filename
        ? `attachment; filename="${input.filename}"`
        : undefined,
    });
    const url = await getSignedUrl(this.client, cmd, { expiresIn: this.opts.presignTtl });
    return {
      url,
      expiresAt: new Date(Date.now() + this.opts.presignTtl * 1000),
    };
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
