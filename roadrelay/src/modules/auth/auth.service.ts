import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

import { PG_POOL } from '@infrastructure/database/database.module';
import { NotificationService } from '@infrastructure/notifications/notification.service';
import { PiiCrypto } from '@common/utils/pii-crypto';
import { assertE164, lastFour } from '@common/utils/phone';
import { UsersService } from '@modules/users/users.service';
import { AuditService } from '@modules/audit/audit.service';

import { OtpService } from './otp.service';
import { TokenService, IssuedTokens } from './token.service';

export interface StartVerificationResult {
  challengeId: string;
  expiresAt: Date;
  resendCooldownSeconds: number;
  devCode?: string;
}

export interface CompleteVerificationResult {
  user: { id: string; phoneLastFour: string; status: string };
  tokens: IssuedTokens;
  isNewUser: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly pii: PiiCrypto;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {
    this.pii = new PiiCrypto(
      this.config.get<string>('auth.pii.encryptionKey')!,
      this.config.get<string>('auth.pii.encryptionKeyId')!,
      this.config.get<string>('auth.pii.phoneHmacSecret')!,
    );
  }

  async startVerification(phoneNumber: string, ip?: string): Promise<StartVerificationResult> {
    assertE164(phoneNumber);
    const phoneHash = this.pii.hash(phoneNumber);

    // Determine purpose: signup (no row yet) or login (row exists).
    const existing = await this.users.findByPhoneHash(phoneHash);
    const purpose: 'signup' | 'login' = existing ? 'login' : 'signup';

    const { challengeId, expiresAt, devCode } = await this.otp.issue(phoneHash, purpose);

    // Send via SMS provider. We never log the code (except in stub mode).
    await this.notifications.sendOtpSms(phoneNumber, devCode ?? '••••••');

    await this.audit.write({
      actorKind: 'system',
      action: 'auth.otp_issued',
      targetKind: 'phone',
      targetId: undefined,
      metadata: {
        purpose,
        phoneLastFour: lastFour(phoneNumber),
        ip,
      },
    });

    return {
      challengeId,
      expiresAt,
      resendCooldownSeconds: this.config.get<number>('auth.otp.resendCooldown')!,
      devCode,
    };
  }

  async completeVerification(
    phoneNumber: string,
    code: string,
    deviceInfo?: { installId?: string; platform?: 'ios' | 'android' | 'web'; ip?: string; userAgent?: string },
  ): Promise<CompleteVerificationResult> {
    assertE164(phoneNumber);
    if (!/^\d{4,8}$/.test(code)) throw new BadRequestException('invalid_code_format');

    const phoneHash = this.pii.hash(phoneNumber);
    const ok = await this.otp.verify(phoneHash, code);
    if (!ok) {
      await this.audit.write({
        actorKind: 'system',
        action: 'auth.otp_failed',
        metadata: { phoneLastFour: lastFour(phoneNumber), ip: deviceInfo?.ip },
      });
      throw new UnauthorizedException('invalid_code');
    }

    // Upsert user. We use the deterministic hash as the unique key.
    let user = await this.users.findByPhoneHash(phoneHash);
    let isNewUser = false;
    if (!user) {
      const ciphertext = this.pii.encrypt(phoneNumber);
      user = await this.users.create({
        phoneHash,
        phoneCiphertext: ciphertext,
        phoneKeyId: this.pii.keyId,
        phoneLastFour: lastFour(phoneNumber),
      });
      isNewUser = true;
    }

    if (user.status === 'banned' || user.status === 'deleted') {
      throw new UnauthorizedException('account_locked');
    }

    // Activate on first successful verification.
    if (user.status === 'pending') {
      user = await this.users.markActiveAndVerified(user.id);
    } else {
      await this.users.touchLogin(user.id);
    }

    // Register / update the device record.
    let deviceId: string | undefined;
    if (deviceInfo?.installId && deviceInfo.platform) {
      deviceId = await this.users.upsertDevice({
        userId: user.id,
        installId: deviceInfo.installId,
        platform: deviceInfo.platform,
        ip: deviceInfo.ip,
        userAgent: deviceInfo.userAgent,
      });
    }

    const tokens = await this.tokens.issueTokens({
      id: user.id,
      role: user.role,
      trustScore: user.trustScore,
      status: user.status,
      deviceId,
    });

    await this.audit.write({
      actorKind: 'user',
      actorId: user.id,
      action: isNewUser ? 'auth.signup' : 'auth.login',
      metadata: { deviceId, ip: deviceInfo?.ip },
    });

    return {
      user: {
        id: user.id,
        phoneLastFour: user.phoneLastFour,
        status: user.status,
      },
      tokens,
      isNewUser,
    };
  }
}
