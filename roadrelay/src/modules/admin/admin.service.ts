import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { AuditService } from '@modules/audit/audit.service';

export interface PendingVehicleRow {
  id: string;
  userId: string;
  state: string;
  plateNormalized: string;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: string;
  createdAt: Date;
  artifacts: Array<{
    id: string;
    kind: string;
    contentType: string;
    bytes: number;
    storageKey: string;
  }>;
}

@Injectable()
export class AdminService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  async listPendingVehicles(limit = 50, offset = 0): Promise<PendingVehicleRow[]> {
    const { rows } = await this.pool.query(
      `SELECT v.id, v.user_id, v.state_code, v.plate_normalized,
              v.make, v.model, v.year, v.color, v.status, v.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', a.id,
                    'kind', a.kind,
                    'contentType', a.content_type,
                    'bytes', a.bytes,
                    'storageKey', a.storage_key
                  )
                ) FILTER (WHERE a.id IS NOT NULL),
                '[]'::json
              ) AS artifacts
         FROM vehicle_registrations v
         LEFT JOIN vehicle_verification_artifacts a ON a.vehicle_id = v.id
        WHERE v.status = 'pending_review' AND v.deleted_at IS NULL
        GROUP BY v.id
        ORDER BY v.created_at ASC
        LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      state: r.state_code,
      plateNormalized: r.plate_normalized,
      make: r.make,
      model: r.model,
      year: r.year,
      color: r.color,
      status: r.status,
      createdAt: r.created_at,
      artifacts: r.artifacts ?? [],
    }));
  }

  async approveVehicle(adminId: string, vehicleId: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE vehicle_registrations
          SET status = 'verified',
              verified_at = NOW(),
              verified_by = $2
        WHERE id = $1 AND status = 'pending_review' AND deleted_at IS NULL`,
      [vehicleId, adminId],
    );
    if (!rowCount) throw new NotFoundException('vehicle_not_found');
    await this.audit.write({
      actorKind: 'admin',
      actorId: adminId,
      action: 'admin.vehicle_approve',
      targetKind: 'vehicle',
      targetId: vehicleId,
    });
  }

  async rejectVehicle(adminId: string, vehicleId: string, reason: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE vehicle_registrations
          SET status = 'rejected',
              rejection_reason = $2
        WHERE id = $1 AND status = 'pending_review' AND deleted_at IS NULL`,
      [vehicleId, reason],
    );
    if (!rowCount) throw new NotFoundException('vehicle_not_found');
    await this.audit.write({
      actorKind: 'admin',
      actorId: adminId,
      action: 'admin.vehicle_reject',
      targetKind: 'vehicle',
      targetId: vehicleId,
      metadata: { reason },
    });
  }

  async listOpenReports(limit = 50): Promise<unknown[]> {
    const { rows } = await this.pool.query(
      `SELECT id, reporter_id, reported_user_id, kind, description, status, created_at
         FROM abuse_reports
        WHERE status IN ('open', 'triaging')
        ORDER BY created_at ASC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async actionReport(
    adminId: string,
    reportId: string,
    action: 'dismiss' | 'warn' | 'suspend' | 'ban',
    note: string,
  ): Promise<void> {
    if (action === 'dismiss') {
      await this.pool.query(
        `UPDATE abuse_reports
            SET status = 'dismissed',
                resolution_note = $2,
                resolved_at = NOW(),
                assigned_to = $3
          WHERE id = $1`,
        [reportId, note, adminId],
      );
      return;
    }

    const sanctionKind = action === 'warn' ? 'warning' : action === 'suspend' ? 'suspended' : 'banned';
    const ttlHours = action === 'warn' ? null : action === 'suspend' ? 72 : null;

    const { rows } = await this.pool.query<{ reported_user_id: string | null }>(
      `SELECT reported_user_id FROM abuse_reports WHERE id = $1`,
      [reportId],
    );
    const userId = rows[0]?.reported_user_id;
    if (!userId) throw new NotFoundException('report_not_found');

    await this.pool.query(
      `INSERT INTO sanctions (user_id, kind, reason, source, source_ref, ends_at, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        userId,
        sanctionKind,
        note,
        `report:${reportId}`,
        reportId,
        ttlHours ? new Date(Date.now() + ttlHours * 3600 * 1000) : null,
        adminId,
      ],
    );

    if (action === 'ban') {
      await this.pool.query(`UPDATE users SET status = 'banned' WHERE id = $1`, [userId]);
    } else if (action === 'suspend') {
      await this.pool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [userId]);
    }

    await this.pool.query(
      `UPDATE abuse_reports
          SET status = 'actioned',
              resolution_note = $2,
              resolved_at = NOW(),
              assigned_to = $3
        WHERE id = $1`,
      [reportId, note, adminId],
    );

    await this.audit.write({
      actorKind: 'admin',
      actorId: adminId,
      action: `admin.report_${action}`,
      targetKind: 'user',
      targetId: userId,
      metadata: { reportId, note },
    });
  }
}
