import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { IRelayProvider, RELAY_PROVIDER } from '@infrastructure/relay/tokens';

export interface RelaySessionRow {
  id: string;
  contactRequestId: string;
  participantAId: string;
  participantBId: string;
  participantAAlias: string;
  participantBAlias: string;
  status: 'active' | 'closed' | 'expired' | 'terminated';
  provider: string;
  providerSessionId: string | null;
  expiresAt: Date;
  closedAt: Date | null;
}

@Injectable()
export class RelaySessionsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(RELAY_PROVIDER) private readonly relay: IRelayProvider,
    private readonly config: ConfigService,
  ) {}

  /**
   * Open a session as part of a transaction (called by ContactRequestsService.accept).
   * Aliases are deterministic but opaque (e.g. "Driver A93", "Driver F12").
   */
  async openSessionTx(
    client: PoolClient,
    args: { contactRequestId: string; participantA: string; participantB: string },
  ): Promise<RelaySessionRow> {
    const ttl = this.config.get<number>('storage.relay.sessionTtl')!;
    const aliasA = generateAlias();
    const aliasB = generateAlias(aliasA);

    const providerResult = await this.relay.open({
      contactRequestId: args.contactRequestId,
      participantA: { userId: args.participantA, alias: aliasA },
      participantB: { userId: args.participantB, alias: aliasB },
      ttlSeconds: ttl,
    });

    const expiresAt = new Date(Date.now() + ttl * 1000);
    const { rows } = await client.query(
      `INSERT INTO relay_sessions
         (contact_request_id, participant_a_id, participant_b_id,
          participant_a_alias, participant_b_alias,
          provider, provider_session_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        args.contactRequestId,
        args.participantA,
        args.participantB,
        aliasA,
        aliasB,
        'internal',
        providerResult.providerSessionId,
        expiresAt,
      ],
    );
    return mapRow(rows[0]);
  }

  async getSession(userId: string, id: string): Promise<RelaySessionRow> {
    const { rows } = await this.pool.query(
      `SELECT * FROM relay_sessions WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('session_not_found');
    const row = mapRow(rows[0]);
    if (row.participantAId !== userId && row.participantBId !== userId) {
      throw new ForbiddenException('not_a_participant');
    }
    return row;
  }

  async endSession(userId: string, id: string, reason: string): Promise<void> {
    const session = await this.getSession(userId, id);
    if (session.status !== 'active') return;

    if (session.providerSessionId) {
      await this.relay.close({
        providerSessionId: session.providerSessionId,
        reason,
      });
    }

    await this.pool.query(
      `UPDATE relay_sessions
          SET status = 'closed',
              closed_at = NOW(),
              closed_reason = $2
        WHERE id = $1 AND status = 'active'`,
      [id, reason],
    );

    await this.pool.query(
      `INSERT INTO relay_events (session_id, actor_id, kind, metadata)
       VALUES ($1, $2, 'session_closed', $3::jsonb)`,
      [id, userId, JSON.stringify({ reason })],
    );
  }
}

function generateAlias(exclude?: string): string {
  const letters = 'BCDFGHJKLMNPQRSTVWXZ'; // no vowels (avoids accidental words)
  let alias = '';
  do {
    alias = `Driver-${letters[Math.floor(Math.random() * letters.length)]}${Math.floor(
      100 + Math.random() * 900,
    )}`;
  } while (alias === exclude);
  return alias;
}

function mapRow(row: Record<string, unknown>): RelaySessionRow {
  return {
    id: row.id as string,
    contactRequestId: row.contact_request_id as string,
    participantAId: row.participant_a_id as string,
    participantBId: row.participant_b_id as string,
    participantAAlias: row.participant_a_alias as string,
    participantBAlias: row.participant_b_alias as string,
    status: row.status as RelaySessionRow['status'],
    provider: row.provider as string,
    providerSessionId: (row.provider_session_id as string | null) ?? null,
    expiresAt: row.expires_at as Date,
    closedAt: (row.closed_at as Date | null) ?? null,
  };
}
