import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { normalizePlate } from '@common/utils/plate';

export interface VehicleRow {
  id: string;
  userId: string;
  plateRaw: string;
  plateNormalized: string;
  stateCode: string;
  countryCode: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vinLastFour: string | null;
  status: 'unverified' | 'pending_review' | 'verified' | 'rejected' | 'revoked';
  visibility: 'public' | 'private' | 'hidden';
}

export interface CreateVehicleInput {
  userId: string;
  plate: string;
  state: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vinLastFour?: string;
}

@Injectable()
export class VehiclesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(input: CreateVehicleInput): Promise<VehicleRow> {
    let normalized: string;
    try {
      normalized = normalizePlate(input.plate);
    } catch (err) {
      throw new BadRequestException(`invalid_plate: ${(err as Error).message}`);
    }
    if (!/^[A-Z]{2}$/.test(input.state)) {
      throw new BadRequestException('invalid_state_code');
    }

    // Check the user doesn't already have THIS plate (state+normalized)
    // listed (verified or otherwise).
    const existing = await this.pool.query(
      `SELECT id FROM vehicle_registrations
        WHERE user_id = $1
          AND state_code = $2
          AND plate_normalized = $3
          AND deleted_at IS NULL`,
      [input.userId, input.state, normalized],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new BadRequestException('vehicle_already_added');
    }

    const { rows } = await this.pool.query(
      `INSERT INTO vehicle_registrations
         (user_id, plate_raw, plate_normalized, state_code, make, model, year, color, vin_last_four)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, user_id, plate_raw, plate_normalized, state_code, country_code,
                 make, model, year, color, vin_last_four, status, visibility`,
      [
        input.userId,
        input.plate,
        normalized,
        input.state,
        input.make ?? null,
        input.model ?? null,
        input.year ?? null,
        input.color ?? null,
        input.vinLastFour ?? null,
      ],
    );
    return mapVehicle(rows[0]);
  }

  async listForUser(userId: string): Promise<VehicleRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, plate_raw, plate_normalized, state_code, country_code,
              make, model, year, color, vin_last_four, status, visibility
         FROM vehicle_registrations
        WHERE user_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(mapVehicle);
  }

  async getOwnedById(userId: string, vehicleId: string): Promise<VehicleRow> {
    const { rows } = await this.pool.query(
      `SELECT id, user_id, plate_raw, plate_normalized, state_code, country_code,
              make, model, year, color, vin_last_four, status, visibility
         FROM vehicle_registrations
        WHERE id = $1 AND deleted_at IS NULL`,
      [vehicleId],
    );
    if (rows.length === 0) throw new NotFoundException('vehicle_not_found');
    if (rows[0].user_id !== userId) throw new ForbiddenException('not_vehicle_owner');
    return mapVehicle(rows[0]);
  }

  /**
   * Find a verified vehicle by (state, plate). Returns null if no verified
   * registration exists. Used by the plate-lookup feature.
   */
  async findVerifiedByPlate(state: string, plate: string): Promise<VehicleRow | null> {
    let normalized: string;
    try {
      normalized = normalizePlate(plate);
    } catch (err) {
      throw new BadRequestException(`invalid_plate: ${(err as Error).message}`);
    }
    const { rows } = await this.pool.query(
      `SELECT id, user_id, plate_raw, plate_normalized, state_code, country_code,
              make, model, year, color, vin_last_four, status, visibility
         FROM vehicle_registrations
        WHERE state_code = $1
          AND plate_normalized = $2
          AND status = 'verified'
          AND deleted_at IS NULL
        LIMIT 1`,
      [state, normalized],
    );
    if (rows.length === 0) return null;
    return mapVehicle(rows[0]);
  }

  async updateVisibility(
    userId: string,
    vehicleId: string,
    visibility: 'public' | 'private' | 'hidden',
  ): Promise<VehicleRow> {
    await this.getOwnedById(userId, vehicleId);
    const { rows } = await this.pool.query(
      `UPDATE vehicle_registrations
          SET visibility = $2
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, user_id, plate_raw, plate_normalized, state_code, country_code,
                  make, model, year, color, vin_last_four, status, visibility`,
      [vehicleId, visibility],
    );
    return mapVehicle(rows[0]);
  }

  async submitForReview(userId: string, vehicleId: string): Promise<VehicleRow> {
    const vehicle = await this.getOwnedById(userId, vehicleId);
    if (vehicle.status === 'verified') {
      throw new BadRequestException('vehicle_already_verified');
    }
    // Require at least one clean artifact before allowing submission.
    const { rows: artifacts } = await this.pool.query(
      `SELECT COUNT(*)::int AS count
         FROM vehicle_verification_artifacts
        WHERE vehicle_id = $1 AND status IN ('clean', 'uploaded')`,
      [vehicleId],
    );
    if (artifacts[0].count === 0) {
      throw new BadRequestException('no_artifacts_uploaded');
    }
    const { rows } = await this.pool.query(
      `UPDATE vehicle_registrations
          SET status = 'pending_review'
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, user_id, plate_raw, plate_normalized, state_code, country_code,
                  make, model, year, color, vin_last_four, status, visibility`,
      [vehicleId],
    );
    return mapVehicle(rows[0]);
  }
}

function mapVehicle(row: Record<string, unknown>): VehicleRow {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    plateRaw: row.plate_raw as string,
    plateNormalized: row.plate_normalized as string,
    stateCode: row.state_code as string,
    countryCode: row.country_code as string,
    make: (row.make as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    year: (row.year as number | null) ?? null,
    color: (row.color as string | null) ?? null,
    vinLastFour: (row.vin_last_four as string | null) ?? null,
    status: row.status as VehicleRow['status'],
    visibility: row.visibility as VehicleRow['visibility'],
  };
}
