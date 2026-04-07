import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';

export interface UserRow {
  id: string;
  phoneHash: Buffer;
  phoneLastFour: string;
  displayName: string | null;
  role: 'user' | 'moderator' | 'admin';
  status: 'pending' | 'active' | 'suspended' | 'banned' | 'deleted';
  trustScore: number;
}

export interface CreateUserInput {
  phoneHash: Buffer;
  phoneCiphertext: Buffer;
  phoneKeyId: string;
  phoneLastFour: string;
}

export interface UpsertDeviceInput {
  userId: string;
  installId: string;
  platform: 'ios' | 'android' | 'web';
  pushToken?: string;
  appVersion?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class UsersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async findByPhoneHash(phoneHash: Buffer): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, phone_number_hash, phone_last_four, display_name, role, status, trust_score
         FROM users
        WHERE phone_number_hash = $1
          AND deleted_at IS NULL`,
      [phoneHash],
    );
    if (rows.length === 0) return null;
    return mapUser(rows[0]);
  }

  async findById(id: string): Promise<UserRow | null> {
    const { rows } = await this.pool.query(
      `SELECT id, phone_number_hash, phone_last_four, display_name, role, status, trust_score
         FROM users
        WHERE id = $1
          AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) return null;
    return mapUser(rows[0]);
  }

  async create(input: CreateUserInput): Promise<UserRow> {
    const { rows } = await this.pool.query(
      `INSERT INTO users
         (phone_number_hash, phone_number_ciphertext, phone_key_id, phone_last_four, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING id, phone_number_hash, phone_last_four, display_name, role, status, trust_score`,
      [input.phoneHash, input.phoneCiphertext, input.phoneKeyId, input.phoneLastFour],
    );
    return mapUser(rows[0]);
  }

  async markActiveAndVerified(id: string): Promise<UserRow> {
    const { rows } = await this.pool.query(
      `UPDATE users
          SET status = 'active',
              phone_verified_at = NOW(),
              last_login_at = NOW()
        WHERE id = $1
          AND deleted_at IS NULL
        RETURNING id, phone_number_hash, phone_last_four, display_name, role, status, trust_score`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('user_not_found');
    return mapUser(rows[0]);
  }

  async touchLogin(id: string): Promise<void> {
    await this.pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [id]);
  }

  async upsertDevice(input: UpsertDeviceInput): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO devices (user_id, install_id, platform, push_token, app_version, ip_last_seen, user_agent, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (user_id, install_id) DO UPDATE
         SET push_token   = COALESCE(EXCLUDED.push_token, devices.push_token),
             app_version  = COALESCE(EXCLUDED.app_version, devices.app_version),
             ip_last_seen = COALESCE(EXCLUDED.ip_last_seen, devices.ip_last_seen),
             user_agent   = COALESCE(EXCLUDED.user_agent, devices.user_agent),
             last_seen_at = NOW()
       RETURNING id`,
      [
        input.userId,
        input.installId,
        input.platform,
        input.pushToken ?? null,
        input.appVersion ?? null,
        input.ip ?? null,
        input.userAgent ?? null,
      ],
    );
    return rows[0].id;
  }

  async getProfile(id: string): Promise<{
    id: string;
    displayName: string | null;
    phoneLastFour: string;
    role: string;
    status: string;
    trustScore: number;
    createdAt: Date;
  }> {
    const { rows } = await this.pool.query(
      `SELECT id, display_name, phone_last_four, role, status, trust_score, created_at
         FROM users
        WHERE id = $1
          AND deleted_at IS NULL`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('user_not_found');
    const r = rows[0];
    return {
      id: r.id,
      displayName: r.display_name,
      phoneLastFour: r.phone_last_four,
      role: r.role,
      status: r.status,
      trustScore: r.trust_score,
      createdAt: r.created_at,
    };
  }

  async adjustTrustScore(id: string, delta: number, reason: string): Promise<number> {
    const { rows } = await this.pool.query<{ trust_score: number }>(
      `UPDATE users
          SET trust_score = GREATEST(0, LEAST(1000, trust_score + $2))
        WHERE id = $1
        RETURNING trust_score`,
      [id, delta],
    );
    if (rows.length === 0) throw new NotFoundException('user_not_found');
    // The reason is intentionally not stored on users; the source of truth
    // is the audit_logs / sanctions tables which the caller should write.
    void reason;
    return rows[0].trust_score;
  }
}

function mapUser(row: Record<string, unknown>): UserRow {
  return {
    id: row.id as string,
    phoneHash: row.phone_number_hash as Buffer,
    phoneLastFour: row.phone_last_four as string,
    displayName: (row.display_name as string | null) ?? null,
    role: row.role as UserRow['role'],
    status: row.status as UserRow['status'],
    trustScore: row.trust_score as number,
  };
}
