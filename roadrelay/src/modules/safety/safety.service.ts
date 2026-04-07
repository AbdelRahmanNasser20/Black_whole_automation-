import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { AuditService } from '@modules/audit/audit.service';

export interface ReportInput {
  reporterId: string;
  reportedUserId: string;
  kind: string;
  description?: string;
  contactRequestId?: string;
  relaySessionId?: string;
  vehicleId?: string;
}

@Injectable()
export class SafetyService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  async block(blockerId: string, blockedId: string, reason?: string): Promise<void> {
    if (blockerId === blockedId) throw new BadRequestException('cannot_block_self');
    await this.pool.query(
      `INSERT INTO blocks (blocker_id, blocked_id, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (blocker_id, blocked_id) DO NOTHING`,
      [blockerId, blockedId, reason ?? null],
    );
    await this.audit.write({
      actorKind: 'user',
      actorId: blockerId,
      action: 'safety.block',
      targetKind: 'user',
      targetId: blockedId,
      metadata: { reason },
    });
  }

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2`,
      [blockerId, blockedId],
    );
    await this.audit.write({
      actorKind: 'user',
      actorId: blockerId,
      action: 'safety.unblock',
      targetKind: 'user',
      targetId: blockedId,
    });
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM blocks
        WHERE (blocker_id = $1 AND blocked_id = $2)
           OR (blocker_id = $2 AND blocked_id = $1)
        LIMIT 1`,
      [a, b],
    );
    return rows.length > 0;
  }

  async report(input: ReportInput): Promise<{ id: string }> {
    if (input.reporterId === input.reportedUserId) {
      throw new BadRequestException('cannot_report_self');
    }
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO abuse_reports
         (reporter_id, reported_user_id, kind, description,
          contact_request_id, relay_session_id, vehicle_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.reporterId,
        input.reportedUserId,
        input.kind,
        input.description ?? null,
        input.contactRequestId ?? null,
        input.relaySessionId ?? null,
        input.vehicleId ?? null,
      ],
    );

    await this.audit.write({
      actorKind: 'user',
      actorId: input.reporterId,
      action: 'safety.report',
      targetKind: 'user',
      targetId: input.reportedUserId,
      metadata: { kind: input.kind, reportId: rows[0].id },
    });

    return rows[0];
  }

  async getSafetyStatus(userId: string): Promise<{
    blockedCount: number;
    activeSanctions: Array<{ kind: string; reason: string; endsAt: Date | null }>;
    openReportsAgainstYou: number;
  }> {
    const [blocks, sanctions, reports] = await Promise.all([
      this.pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM blocks WHERE blocker_id = $1`,
        [userId],
      ),
      this.pool.query<{ kind: string; reason: string; ends_at: Date | null }>(
        `SELECT kind, reason, ends_at FROM sanctions
          WHERE user_id = $1 AND status = 'active'
          ORDER BY created_at DESC`,
        [userId],
      ),
      this.pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM abuse_reports
          WHERE reported_user_id = $1 AND status IN ('open', 'triaging')`,
        [userId],
      ),
    ]);

    return {
      blockedCount: blocks.rows[0]?.count ?? 0,
      activeSanctions: sanctions.rows.map((r) => ({
        kind: r.kind,
        reason: r.reason,
        endsAt: r.ends_at,
      })),
      openReportsAgainstYou: reports.rows[0]?.count ?? 0,
    };
  }
}
