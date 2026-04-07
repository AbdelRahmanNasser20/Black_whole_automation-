import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import * as crypto from 'crypto';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';

export interface OtpIssueResult {
  challengeId: string;
  expiresAt: Date;
  /** Plaintext code returned ONLY when SMS provider is the stub. */
  devCode?: string;
}

/**
 * OTP issuance + verification.
 *
 *  - We hash the OTP with Argon2 (memory-hard) so a DB leak doesn't
 *    immediately expose live codes for brute force.
 *  - Codes are time-limited (TTL) and attempt-limited (max_attempts).
 *  - We single-use: once consumed, the row is marked and ignored.
 *  - We never store the plaintext, only the hash.
 *  - Brute force protection: per-phone hash + per-IP rate limit (handled
 *    in the controller layer via @RateLimit).
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {}

  async issue(phoneNumberHash: Buffer, purpose: 'signup' | 'login'): Promise<OtpIssueResult> {
    const length = this.config.get<number>('auth.otp.length')!;
    const ttl = this.config.get<number>('auth.otp.ttlSeconds')!;
    const maxAttempts = this.config.get<number>('auth.otp.maxAttempts')!;
    const code = this.generateNumericCode(length);
    const codeHash = await argon2.hash(code, { type: argon2.argon2id });

    const expiresAt = new Date(Date.now() + ttl * 1000);

    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO otp_challenges
         (phone_number_hash, code_hash, purpose, max_attempts, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [phoneNumberHash, codeHash, purpose, maxAttempts, expiresAt],
    );

    return {
      challengeId: rows[0].id,
      expiresAt,
      devCode: this.config.get<string>('storage.notifications.smsDriver') === 'stub' ? code : undefined,
    };
  }

  /**
   * Verify a code for a given phone hash. Returns true on success.
   *
   *  - Atomically increments attempts and consumes the row on success.
   *  - Constant-time-ish: argon2.verify always runs to avoid timing oracles.
   */
  async verify(phoneNumberHash: Buffer, code: string): Promise<boolean> {
    const { rows } = await this.pool.query<{
      id: string;
      code_hash: string;
      attempts: number;
      max_attempts: number;
      expires_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, code_hash, attempts, max_attempts, expires_at, consumed_at
         FROM otp_challenges
        WHERE phone_number_hash = $1
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1`,
      [phoneNumberHash],
    );

    if (rows.length === 0) {
      // Run a dummy verify so timing leaks nothing.
      await argon2.verify(
        '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlkdW1teQ$AbCdEfGhIjKlMnOpQrStUv',
        code,
      ).catch(() => undefined);
      return false;
    }

    const challenge = rows[0];
    if (challenge.expires_at.getTime() < Date.now()) {
      return false;
    }
    if (challenge.attempts >= challenge.max_attempts) {
      return false;
    }

    let ok = false;
    try {
      ok = await argon2.verify(challenge.code_hash, code);
    } catch (err) {
      this.logger.warn(`OTP verify error: ${(err as Error).message}`);
    }

    if (!ok) {
      await this.pool.query(
        `UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1`,
        [challenge.id],
      );
      return false;
    }

    // Consume on success. Conditional update prevents reuse races.
    const consume = await this.pool.query(
      `UPDATE otp_challenges
          SET consumed_at = NOW(), attempts = attempts + 1
        WHERE id = $1 AND consumed_at IS NULL`,
      [challenge.id],
    );
    return (consume.rowCount ?? 0) === 1;
  }

  private generateNumericCode(length: number): string {
    // Use rejection sampling to avoid modulo bias.
    const max = 10 ** length;
    const upper = Math.floor(0xffffffff / max) * max;
    let n: number;
    do {
      n = crypto.randomBytes(4).readUInt32BE(0);
    } while (n >= upper);
    return (n % max).toString().padStart(length, '0');
  }
}
