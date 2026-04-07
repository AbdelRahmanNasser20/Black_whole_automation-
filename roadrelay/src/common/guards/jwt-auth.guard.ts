import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { AuthenticatedUser } from '../types/auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing_bearer_token');
    }
    const token = header.slice('Bearer '.length);

    let payload: {
      sub: string;
      role: AuthenticatedUser['role'];
      ts: number;
      st: AuthenticatedUser['status'];
      did?: string;
    };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('auth.jwt.accessSecret'),
      });
    } catch {
      throw new UnauthorizedException('invalid_token');
    }

    if (payload.st === 'banned' || payload.st === 'deleted') {
      throw new UnauthorizedException('account_locked');
    }

    req.user = {
      id: payload.sub,
      role: payload.role,
      trustScore: payload.ts,
      status: payload.st,
      deviceId: payload.did,
    };
    return true;
  }
}
