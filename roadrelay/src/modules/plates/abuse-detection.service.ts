import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';

export interface AbuseSignal {
  /** 0..100, higher = more suspicious. */
  score: number;
  reasons: string[];
}

/**
 * AbuseDetectionService inspects a single plate-lookup attempt and
 * returns a heuristic abuse score. The MVP implements simple velocity
 * heuristics; signals come from the plate_search_logs table and Redis
 * counters.
 *
 * Heuristics implemented:
 *  1. Burst:        > 10 lookups in 60 seconds (per user)
 *  2. Cardinality:  > 25 distinct plates / 10 minutes (per user)
 *  3. Repeats:      same plate looked up > 3 times in 24h (per user)
 *  4. Cross-IP:     same user across > 3 IPs in 1 hour
 *  5. Ghost user:   account < 24h old with no verified vehicle
 *
 * Future hooks: device fingerprint clustering, ML scoring, geo deltas.
 */
@Injectable()
export class AbuseDetectionService {
  private readonly logger = new Logger(AbuseDetectionService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async scoreLookup(input: {
    userId: string;
    plateQueryHash: Buffer;
    ip?: string;
  }): Promise<AbuseSignal> {
    const reasons: string[] = [];
    let score = 0;

    const { rows } = await this.pool.query<{
      burst_60s: number;
      distinct_10m: number;
      same_plate_24h: number;
      distinct_ip_1h: number;
      account_age_hours: number;
      verified_vehicles: number;
    }>(
      `WITH log AS (
         SELECT created_at, plate_query_hash, ip
           FROM plate_search_logs
          WHERE user_id = $1
            AND created_at > NOW() - INTERVAL '24 hours'
       ),
       u AS (
         SELECT EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600 AS account_age_hours
           FROM users WHERE id = $1
       ),
       v AS (
         SELECT COUNT(*)::int AS verified_vehicles
           FROM vehicle_registrations
          WHERE user_id = $1 AND status = 'verified' AND deleted_at IS NULL
       )
       SELECT
         (SELECT COUNT(*) FROM log WHERE created_at > NOW() - INTERVAL '60 seconds')::int AS burst_60s,
         (SELECT COUNT(DISTINCT plate_query_hash) FROM log WHERE created_at > NOW() - INTERVAL '10 minutes')::int AS distinct_10m,
         (SELECT COUNT(*) FROM log WHERE plate_query_hash = $2)::int AS same_plate_24h,
         (SELECT COUNT(DISTINCT ip) FROM log WHERE created_at > NOW() - INTERVAL '1 hour')::int AS distinct_ip_1h,
         (SELECT account_age_hours FROM u)::int AS account_age_hours,
         (SELECT verified_vehicles FROM v)::int AS verified_vehicles
       `,
      [input.userId, input.plateQueryHash],
    );
    const r = rows[0];
    if (!r) return { score: 0, reasons: [] };

    if (r.burst_60s >= 10) {
      score += 35;
      reasons.push('burst_60s');
    }
    if (r.distinct_10m >= 25) {
      score += 30;
      reasons.push('high_cardinality_10m');
    }
    if (r.same_plate_24h >= 4) {
      score += 15;
      reasons.push('repeat_plate_24h');
    }
    if (r.distinct_ip_1h >= 4) {
      score += 15;
      reasons.push('cross_ip_1h');
    }
    if (r.account_age_hours <= 24 && r.verified_vehicles === 0) {
      score += 20;
      reasons.push('ghost_account');
    }

    if (reasons.length > 0) {
      this.logger.warn(
        `abuse signal user=${input.userId} score=${score} reasons=${reasons.join(',')}`,
      );
    }
    return { score: Math.min(100, score), reasons };
  }
}
