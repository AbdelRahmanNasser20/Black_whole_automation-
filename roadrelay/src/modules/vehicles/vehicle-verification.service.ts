import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { ulid } from 'ulid';

import { PG_POOL } from '@infrastructure/database/database.module';
import { STORAGE_PROVIDER, IStorageProvider, PresignedUpload } from '@infrastructure/storage/tokens';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
]);
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class VehicleVerificationService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(STORAGE_PROVIDER) private readonly storage: IStorageProvider,
  ) {}

  async requestUploadUrl(
    userId: string,
    vehicleId: string,
    kind: string,
    contentType: string,
    bytes: number,
  ): Promise<{ uploadUrl: PresignedUpload; storageKey: string }> {
    if (!ALLOWED_MIME.has(contentType)) {
      throw new BadRequestException('unsupported_content_type');
    }
    if (bytes <= 0 || bytes > MAX_BYTES) {
      throw new BadRequestException('file_too_large');
    }

    // Confirm vehicle ownership.
    const { rows } = await this.pool.query(
      `SELECT id FROM vehicle_registrations
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [vehicleId, userId],
    );
    if (rows.length === 0) throw new NotFoundException('vehicle_not_found');

    const storageKey = `verifications/${vehicleId}/${kind}/${ulid()}`;
    const uploadUrl = await this.storage.presignUpload({
      key: storageKey,
      contentType,
      maxBytes: bytes,
    });

    return { uploadUrl, storageKey };
  }

  async registerCompletedUpload(
    userId: string,
    vehicleId: string,
    kind: string,
    storageKey: string,
    contentType: string,
    bytes: number,
    sha256Hex: string,
  ): Promise<{ id: string }> {
    // Recheck ownership and bind the artifact row.
    const { rows: vehicleRows } = await this.pool.query(
      `SELECT id FROM vehicle_registrations
        WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [vehicleId, userId],
    );
    if (vehicleRows.length === 0) throw new NotFoundException('vehicle_not_found');

    const { rows } = await this.pool.query(
      `INSERT INTO vehicle_verification_artifacts
         (vehicle_id, uploaded_by, kind, storage_key, storage_bucket, content_type, bytes, sha256, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, decode($8, 'hex'), 'uploaded')
       RETURNING id`,
      [
        vehicleId,
        userId,
        kind,
        storageKey,
        this.storage.bucket(),
        contentType,
        bytes,
        sha256Hex,
      ],
    );
    return { id: rows[0].id };
  }
}
