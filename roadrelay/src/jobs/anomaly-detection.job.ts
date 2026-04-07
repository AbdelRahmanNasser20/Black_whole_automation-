import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { TrustScoreService } from '@modules/plates/trust-score.service';
import { AuditService } from '@modules/audit/audit.service';

/**
 * Periodic anomaly sweep. Looks at plate_search_logs for the last hour
 * and applies trust adjustments / sanctions to repeat offenders.
 *
 * Decoupled from the request path so per-request latency stays low.
 */
@Injectable()
export class AnomalyDetectionJob {
  private readonly logger = new Logger(AnomalyDetectionJob.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly trust: TrustScoreService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async run(): Promise<void> {
    const { rows } = await this.pool.query<{
      user_id: string;
      lookups: number;
      distinct_plates: number;
      avg_score: number;
    }>(
      `SELECT user_id,
              COUNT(*)::int           AS lookups,
              COUNT(DISTINCT plate_query_hash)::int AS distinct_plates,
              AVG(abuse_score)::int   AS avg_score
         FROM plate_search_logs
        WHERE created_at > NOW() - INTERVAL '1 hour'
        GROUP BY user_id
       HAVING COUNT(*) > 50 OR AVG(abuse_score) > 30`,
    );

    for (const r of rows) {
      let delta = 0;
      const reasons: string[] = [];
      if (r.lookups > 50) {
        delta -= 25;
        reasons.push('high_volume');
      }
      if (r.lookups > 200) {
        delta -= 75;
        reasons.push('extreme_volume');
      }
      if (r.distinct_plates > 30) {
        delta -= 25;
        reasons.push('high_cardinality');
      }
      if (r.avg_score > 50) {
        delta -= 50;
        reasons.push('persistent_signal');
      }
      if (delta === 0) continue;

      const newScore = await this.trust.adjust(r.user_id, delta, reasons.join(','));
      this.logger.warn(
        `anomaly user=${r.user_id} delta=${delta} new=${newScore} reasons=${reasons.join(',')}`,
      );
      await this.audit.write({
        actorKind: 'system',
        action: 'trust.anomaly_adjust',
        targetKind: 'user',
        targetId: r.user_id,
        metadata: {
          delta,
          newScore,
          reasons,
          lookups: r.lookups,
          distinctPlates: r.distinct_plates,
        },
      });
    }

    if (rows.length > 0) {
      this.logger.log(`anomaly sweep flagged ${rows.length} users`);
    }
  }
}
