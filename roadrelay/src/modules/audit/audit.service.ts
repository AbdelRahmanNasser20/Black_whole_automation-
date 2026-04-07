import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';

export type AuditActorKind = 'user' | 'admin' | 'system' | 'job';

export interface AuditWriteInput {
  actorKind: AuditActorKind;
  actorId?: string;
  action: string;
  targetKind?: string;
  targetId?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit log. NEVER throws to callers — failure to write
 * audit must not break user-facing flows. Errors are logged loudly so
 * monitoring picks them up.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async write(input: AuditWriteInput): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO audit_logs
           (actor_kind, actor_id, action, target_kind, target_id, ip, user_agent, request_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          input.actorKind,
          input.actorId ?? null,
          input.action,
          input.targetKind ?? null,
          input.targetId ?? null,
          input.ip ?? null,
          input.userAgent ?? null,
          input.requestId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    } catch (err) {
      this.logger.error(`audit write failed action=${input.action}`, err as Error);
    }
  }
}
