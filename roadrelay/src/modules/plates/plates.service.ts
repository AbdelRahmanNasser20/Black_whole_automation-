import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { PiiCrypto } from '@common/utils/pii-crypto';
import { plateLookupKey } from '@common/utils/plate';

import { VehiclesService } from '@modules/vehicles/vehicles.service';
import { TrustScoreService } from './trust-score.service';
import { AbuseDetectionService } from './abuse-detection.service';

export interface LookupResult {
  matched: boolean;
  /** Public-safe vehicle teaser; never reveals owner identity. */
  vehicle?: {
    id: string;
    state: string;
    plateNormalized: string;
    make: string | null;
    model: string | null;
    color: string | null;
    year: number | null;
    canBeContacted: boolean;
  };
  /** Echoed back so the client can attach a follow-up contact request. */
  lookupId: string;
  abuseScore: number;
}

@Injectable()
export class PlatesService {
  private readonly logger = new Logger(PlatesService.name);
  private readonly pii: PiiCrypto;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly vehicles: VehiclesService,
    private readonly trust: TrustScoreService,
    private readonly abuse: AbuseDetectionService,
  ) {
    this.pii = new PiiCrypto(
      this.config.get<string>('auth.pii.encryptionKey')!,
      this.config.get<string>('auth.pii.encryptionKeyId')!,
      this.config.get<string>('auth.pii.phoneHmacSecret')!,
    );
  }

  async lookup(args: {
    actor: { id: string; deviceId?: string; trustScore: number };
    state: string;
    plate: string;
    ip?: string;
    userAgent?: string;
    geoRegion?: string;
  }): Promise<LookupResult> {
    const gate = this.trust.gateFor(args.actor.trustScore);
    if (!gate.canSearchPlates) {
      // We deliberately return a fake "not found" result for shadowbanned
      // users so they don't realize they're being filtered.
      const lookupId = await this.logSearch({
        userId: args.actor.id,
        deviceId: args.actor.deviceId,
        state: args.state,
        plate: args.plate,
        matched: false,
        matchedVehicleId: null,
        ip: args.ip,
        userAgent: args.userAgent,
        geoRegion: args.geoRegion,
        abuseScore: 100,
      });
      return { matched: false, lookupId, abuseScore: 100 };
    }

    const queryHash = this.pii.hash(plateLookupKey(args.state, args.plate));

    // Score BEFORE running the lookup so we can short-circuit obvious abuse.
    const signal = await this.abuse.scoreLookup({
      userId: args.actor.id,
      plateQueryHash: queryHash,
      ip: args.ip,
    });
    if (signal.score >= 70) {
      // Hard block; trust score gets adjusted by the background job that
      // analyzes the abuse signal log.
      const lookupId = await this.logSearch({
        userId: args.actor.id,
        deviceId: args.actor.deviceId,
        state: args.state,
        plate: args.plate,
        matched: false,
        matchedVehicleId: null,
        ip: args.ip,
        userAgent: args.userAgent,
        geoRegion: args.geoRegion,
        abuseScore: signal.score,
      });
      throw new ForbiddenException('blocked_by_abuse_filter');
    }

    const vehicle = await this.vehicles.findVerifiedByPlate(args.state, args.plate);

    const lookupId = await this.logSearch({
      userId: args.actor.id,
      deviceId: args.actor.deviceId,
      state: args.state,
      plate: args.plate,
      matched: !!vehicle,
      matchedVehicleId: vehicle?.id ?? null,
      ip: args.ip,
      userAgent: args.userAgent,
      geoRegion: args.geoRegion,
      abuseScore: signal.score,
    });

    if (!vehicle) {
      return { matched: false, lookupId, abuseScore: signal.score };
    }

    // Public visibility filter: 'private' means the owner only accepts
    // contact requests from people they've previously interacted with;
    // 'hidden' means the plate is invisible (we still return matched=false).
    if (vehicle.visibility === 'hidden') {
      return { matched: false, lookupId, abuseScore: signal.score };
    }

    return {
      matched: true,
      lookupId,
      abuseScore: signal.score,
      vehicle: {
        id: vehicle.id,
        state: vehicle.stateCode,
        plateNormalized: vehicle.plateNormalized,
        make: vehicle.make,
        model: vehicle.model,
        color: vehicle.color,
        year: vehicle.year,
        canBeContacted: vehicle.visibility !== 'hidden',
      },
    };
  }

  private async logSearch(args: {
    userId: string;
    deviceId?: string;
    state: string;
    plate: string;
    matched: boolean;
    matchedVehicleId: string | null;
    ip?: string;
    userAgent?: string;
    geoRegion?: string;
    abuseScore: number;
  }): Promise<string> {
    const queryHash = this.pii.hash(plateLookupKey(args.state, args.plate));
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO plate_search_logs
         (user_id, device_id, plate_query_hash, state_code, matched, matched_vehicle_id, ip, user_agent, geo_region, abuse_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id::text`,
      [
        args.userId,
        args.deviceId ?? null,
        queryHash,
        args.state,
        args.matched,
        args.matchedVehicleId,
        args.ip ?? null,
        args.userAgent ?? null,
        args.geoRegion ?? null,
        args.abuseScore,
      ],
    );
    return rows[0].id;
  }
}
