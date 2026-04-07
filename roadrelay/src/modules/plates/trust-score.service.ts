import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';

/**
 * Trust score model (0..1000, default 500).
 *
 *  - Verified vehicle:           +75
 *  - Accepted contact request:   +10 (sender), +5 (recipient)
 *  - Declined contact request:   -5 (sender)
 *  - Report dismissed:           -1 (reporter)  -- discourages noise
 *  - Report actioned (against):  -100 (reported)
 *  - Sanction issued:            -250
 *  - Block received:             -8
 *  - 30 days clean activity:     +20 (background job)
 *  - High plate-scan velocity:   -25 to -100 (anomaly job)
 *
 * The score gates feature access:
 *
 *  - <300:   shadowbanned, all writes silently dropped
 *  - <450:   stricter rate limits, no new contact requests
 *  - >=600:  default behavior
 *  - >=800:  reduced friction (auto-accept hint, larger daily limits)
 *
 * NEVER expose the raw score to end users; surface only "verified" tiers.
 */
export interface TrustGate {
  canSearchPlates: boolean;
  canSendContactRequests: boolean;
  shadowbanned: boolean;
  dailyPlateLookups: number;
  dailyContactRequests: number;
}

@Injectable()
export class TrustScoreService {
  private readonly logger = new Logger(TrustScoreService.name);
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  gateFor(score: number): TrustGate {
    if (score < 300) {
      return {
        canSearchPlates: false,
        canSendContactRequests: false,
        shadowbanned: true,
        dailyPlateLookups: 0,
        dailyContactRequests: 0,
      };
    }
    if (score < 450) {
      return {
        canSearchPlates: true,
        canSendContactRequests: false,
        shadowbanned: false,
        dailyPlateLookups: 5,
        dailyContactRequests: 0,
      };
    }
    if (score < 600) {
      return {
        canSearchPlates: true,
        canSendContactRequests: true,
        shadowbanned: false,
        dailyPlateLookups: 20,
        dailyContactRequests: 5,
      };
    }
    if (score < 800) {
      return {
        canSearchPlates: true,
        canSendContactRequests: true,
        shadowbanned: false,
        dailyPlateLookups: 40,
        dailyContactRequests: 10,
      };
    }
    return {
      canSearchPlates: true,
      canSendContactRequests: true,
      shadowbanned: false,
      dailyPlateLookups: 80,
      dailyContactRequests: 20,
    };
  }

  async adjust(userId: string, delta: number, reason: string): Promise<number> {
    const { rows } = await this.pool.query<{ trust_score: number }>(
      `UPDATE users
          SET trust_score = GREATEST(0, LEAST(1000, trust_score + $2))
        WHERE id = $1
        RETURNING trust_score`,
      [userId, delta],
    );
    this.logger.debug(`trust adjust user=${userId} delta=${delta} reason=${reason}`);
    return rows[0]?.trust_score ?? 0;
  }
}
