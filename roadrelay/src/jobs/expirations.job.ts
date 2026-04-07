import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';

/**
 * Background job that expires:
 *   - pending contact requests past their expires_at
 *   - active relay sessions past their expires_at
 *   - active sanctions whose ends_at has passed
 *   - unconsumed otp_challenges (deletes after 24h to keep table tiny)
 *
 * Runs every minute. All UPDATEs are bounded with LIMIT-style work-stealing
 * via CTEs to avoid long-running transactions on hot tables.
 */
@Injectable()
export class ExpirationsJob {
  private readonly logger = new Logger(ExpirationsJob.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run(): Promise<void> {
    try {
      const cr = await this.pool.query(
        `WITH due AS (
           SELECT id FROM contact_requests
            WHERE status = 'pending' AND expires_at < NOW()
            ORDER BY expires_at ASC
            LIMIT 500
            FOR UPDATE SKIP LOCKED
         )
         UPDATE contact_requests c
            SET status = 'expired'
           FROM due
          WHERE c.id = due.id`,
      );

      const rs = await this.pool.query(
        `WITH due AS (
           SELECT id FROM relay_sessions
            WHERE status = 'active' AND expires_at < NOW()
            ORDER BY expires_at ASC
            LIMIT 500
            FOR UPDATE SKIP LOCKED
         )
         UPDATE relay_sessions s
            SET status = 'expired',
                closed_at = NOW(),
                closed_reason = 'ttl'
           FROM due
          WHERE s.id = due.id`,
      );

      const sa = await this.pool.query(
        `UPDATE sanctions
            SET status = 'expired'
          WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at < NOW()`,
      );

      const otp = await this.pool.query(
        `DELETE FROM otp_challenges
           WHERE created_at < NOW() - INTERVAL '24 hours'`,
      );

      this.logger.debug(
        `expirations: cr=${cr.rowCount} relay=${rs.rowCount} sanctions=${sa.rowCount} otp=${otp.rowCount}`,
      );
    } catch (err) {
      this.logger.error('expiration job failed', err as Error);
    }
  }
}
