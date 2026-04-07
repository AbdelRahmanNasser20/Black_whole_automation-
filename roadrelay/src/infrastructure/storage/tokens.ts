export const STORAGE_PROVIDER = Symbol('STORAGE_PROVIDER');

export interface PresignedUploadInput {
  key: string;
  contentType: string;
  maxBytes: number;
}

export interface PresignedUpload {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface PresignedDownloadInput {
  key: string;
  filename?: string;
}

export interface PresignedDownload {
  url: string;
  expiresAt: Date;
}

export interface IStorageProvider {
  bucket(): string;
  presignUpload(input: PresignedUploadInput): Promise<PresignedUpload>;
  presignDownload(input: PresignedDownloadInput): Promise<PresignedDownload>;
  deleteObject(key: string): Promise<void>;
}
