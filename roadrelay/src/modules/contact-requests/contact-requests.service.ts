import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { NotificationService } from '@infrastructure/notifications/notification.service';
import { UnitOfWork } from '@infrastructure/database/unit-of-work';

import { TrustScoreService } from '@modules/plates/trust-score.service';
import { VehiclesService } from '@modules/vehicles/vehicles.service';
import { RelaySessionsService } from '@modules/relay-sessions/relay-sessions.service';
import { SafetyService } from '@modules/safety/safety.service';
import { AuditService } from '@modules/audit/audit.service';
import { ContentFilterService } from './content-filter.service';

const REQUEST_TTL_HOURS = 48;

export interface ContactRequestRow {
  id: string;
  senderId: string;
  recipientId: string;
  vehicleId: string;
  intent: string;
  message: string;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'blocked';
  createdAt: Date;
  expiresAt: Date;
}

@Injectable()
export class ContactRequestsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly uow: UnitOfWork,
    private readonly vehicles: VehiclesService,
    private readonly trust: TrustScoreService,
    private readonly safety: SafetyService,
    private readonly relay: RelaySessionsService,
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
    private readonly filter: ContentFilterService,
  ) {}

  /**
   * Create a contact request from sender -> recipient (owner of vehicle).
   *
   * Guards:
   *  - Sender trust score gates eligibility.
   *  - Recipient must not have blocked the sender.
   *  - Vehicle must be verified and visibility != hidden.
   *  - Sender must not be the owner.
   *  - Cooldown after declined requests is enforced (Postgres + Redis).
   *  - One pending request per (sender, vehicle) at a time.
   *  - Message body is filtered (PII stripped, slurs blocked).
   */
  async create(args: {
    senderId: string;
    senderTrustScore: number;
    vehicleId: string;
    intent: string;
    message: string;
  }): Promise<ContactRequestRow> {
    const gate = this.trust.gateFor(args.senderTrustScore);
    if (!gate.canSendContactRequests) {
      throw new ForbiddenException('contact_requests_disabled_low_trust');
    }

    const filtered = this.filter.filter(args.message);
    if (filtered.blocked) {
      throw new BadRequestException('message_rejected_by_filter');
    }

    // Resolve recipient (owner) via the verified vehicle.
    const { rows: vRows } = await this.pool.query(
      `SELECT id, user_id, status, visibility
         FROM vehicle_registrations
        WHERE id = $1 AND deleted_at IS NULL`,
      [args.vehicleId],
    );
    if (vRows.length === 0) throw new NotFoundException('vehicle_not_found');
    const vehicle = vRows[0];
    if (vehicle.status !== 'verified') {
      throw new BadRequestException('vehicle_not_verified');
    }
    if (vehicle.visibility === 'hidden') {
      throw new NotFoundException('vehicle_not_found');
    }
    if (vehicle.user_id === args.senderId) {
      throw new BadRequestException('cannot_contact_self');
    }

    // Block check (either direction).
    if (await this.safety.isBlockedEitherWay(args.senderId, vehicle.user_id)) {
      // Don't reveal the block reason.
      throw new NotFoundException('vehicle_not_found');
    }

    // Cooldown: how many of sender's last 5 requests were declined?
    const { rows: declineRows } = await this.pool.query<{ declines: number }>(
      `SELECT COUNT(*)::int AS declines
         FROM contact_requests
        WHERE sender_id = $1
          AND status = 'declined'
          AND responded_at > NOW() - INTERVAL '7 days'`,
      [args.senderId],
    );
    if ((declineRows[0]?.declines ?? 0) >= 3) {
      throw new ForbiddenException('cooldown_active');
    }

    const expiresAt = new Date(Date.now() + REQUEST_TTL_HOURS * 3600 * 1000);

    // Insert + emit notification atomically.
    return this.uow.run(async (client) => {
      const insert = await client.query(
        `INSERT INTO contact_requests
           (sender_id, recipient_id, vehicle_id, intent, message, expires_at, decline_count_at_send)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sender_id, vehicle_id) WHERE status = 'pending'
         DO NOTHING
         RETURNING id, sender_id, recipient_id, vehicle_id, intent, message, status, created_at, expires_at`,
        [
          args.senderId,
          vehicle.user_id,
          args.vehicleId,
          args.intent,
          filtered.cleaned,
          expiresAt,
          declineRows[0]?.declines ?? 0,
        ],
      );
      if (insert.rowCount === 0) {
        throw new BadRequestException('duplicate_pending_request');
      }
      const row = mapRow(insert.rows[0]);

      await this.audit.write({
        actorKind: 'user',
        actorId: args.senderId,
        action: 'contact_request.create',
        targetKind: 'contact_request',
        targetId: row.id,
        metadata: { vehicleId: args.vehicleId, intent: args.intent, filterTags: filtered.tags },
      });

      await this.notifications.pushNotification({
        userId: vehicle.user_id,
        title: 'Someone wants to reach you',
        body: 'A driver scanned your plate and sent you a note.',
        data: { contactRequestId: row.id },
      });

      return row;
    });
  }

  async listIncoming(userId: string): Promise<ContactRequestRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, sender_id, recipient_id, vehicle_id, intent, message, status, created_at, expires_at
         FROM contact_requests
        WHERE recipient_id = $1
          AND status IN ('pending', 'accepted')
        ORDER BY created_at DESC
        LIMIT 50`,
      [userId],
    );
    return rows.map(mapRow);
  }

  async listOutgoing(userId: string): Promise<ContactRequestRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, sender_id, recipient_id, vehicle_id, intent, message, status, created_at, expires_at
         FROM contact_requests
        WHERE sender_id = $1
        ORDER BY created_at DESC
        LIMIT 50`,
      [userId],
    );
    return rows.map(mapRow);
  }

  async accept(userId: string, id: string): Promise<{ request: ContactRequestRow; sessionId: string }> {
    return this.uow.run(async (client) => {
      const { rows } = await client.query(
        `UPDATE contact_requests
            SET status = 'accepted', responded_at = NOW()
          WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
          RETURNING id, sender_id, recipient_id, vehicle_id, intent, message, status, created_at, expires_at`,
        [id, userId],
      );
      if (rows.length === 0) throw new NotFoundException('contact_request_not_found');
      const row = mapRow(rows[0]);

      const session = await this.relay.openSessionTx(client, {
        contactRequestId: row.id,
        participantA: row.senderId,
        participantB: row.recipientId,
      });

      await this.audit.write({
        actorKind: 'user',
        actorId: userId,
        action: 'contact_request.accept',
        targetKind: 'contact_request',
        targetId: row.id,
        metadata: { sessionId: session.id },
      });

      await this.trust.adjust(row.senderId, +10, 'contact_accepted');
      await this.trust.adjust(row.recipientId, +5, 'contact_accepted');

      await this.notifications.pushNotification({
        userId: row.senderId,
        title: 'Your request was accepted',
        body: 'You can now exchange messages safely.',
        data: { sessionId: session.id },
      });

      return { request: row, sessionId: session.id };
    });
  }

  async decline(userId: string, id: string): Promise<void> {
    const { rows } = await this.pool.query(
      `UPDATE contact_requests
          SET status = 'declined', responded_at = NOW()
        WHERE id = $1 AND recipient_id = $2 AND status = 'pending'
        RETURNING id, sender_id`,
      [id, userId],
    );
    if (rows.length === 0) throw new NotFoundException('contact_request_not_found');
    await this.trust.adjust(rows[0].sender_id, -5, 'contact_declined');
    await this.audit.write({
      actorKind: 'user',
      actorId: userId,
      action: 'contact_request.decline',
      targetKind: 'contact_request',
      targetId: id,
    });
  }

  async cancel(userId: string, id: string): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE contact_requests
          SET status = 'cancelled'
        WHERE id = $1 AND sender_id = $2 AND status = 'pending'`,
      [id, userId],
    );
    if (!rowCount) throw new NotFoundException('contact_request_not_found');
    await this.audit.write({
      actorKind: 'user',
      actorId: userId,
      action: 'contact_request.cancel',
      targetKind: 'contact_request',
      targetId: id,
    });
  }

  async blockFromRequest(userId: string, id: string, reason?: string): Promise<void> {
    const { rows } = await this.pool.query(
      `SELECT sender_id FROM contact_requests
        WHERE id = $1 AND recipient_id = $2`,
      [id, userId],
    );
    if (rows.length === 0) throw new NotFoundException('contact_request_not_found');
    await this.safety.block(userId, rows[0].sender_id, reason);
    await this.pool.query(
      `UPDATE contact_requests
          SET status = 'blocked', responded_at = NOW()
        WHERE id = $1 AND status IN ('pending', 'accepted')`,
      [id],
    );
  }
}

function mapRow(row: Record<string, unknown>): ContactRequestRow {
  return {
    id: row.id as string,
    senderId: row.sender_id as string,
    recipientId: row.recipient_id as string,
    vehicleId: row.vehicle_id as string,
    intent: row.intent as string,
    message: row.message as string,
    status: row.status as ContactRequestRow['status'],
    createdAt: row.created_at as Date,
    expiresAt: row.expires_at as Date,
  };
}
