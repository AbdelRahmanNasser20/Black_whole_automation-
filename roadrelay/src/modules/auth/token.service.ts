import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { AuthenticatedUser } from '@common/types/auth.types';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issueTokens(user: AuthenticatedUser): Promise<IssuedTokens> {
    const accessTtl = this.config.get<number>('auth.jwt.accessTtl')!;
    const refreshTtl = this.config.get<number>('auth.jwt.refreshTtl')!;

    const claims = {
      sub: user.id,
      role: user.role,
      ts: user.trustScore,
      st: user.status,
      did: user.deviceId,
    };

    const accessToken = await this.jwt.signAsync(claims, {
      secret: this.config.get<string>('auth.jwt.accessSecret'),
      expiresIn: accessTtl,
    });

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, type: 'refresh' },
      {
        secret: this.config.get<string>('auth.jwt.refreshSecret'),
        expiresIn: refreshTtl,
      },
    );

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date(Date.now() + accessTtl * 1000),
      refreshExpiresAt: new Date(Date.now() + refreshTtl * 1000),
    };
  }
}
