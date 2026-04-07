import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';

import { RateLimitService } from './rate-limit.service';

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSeconds: number;
  /** Subject extractor — defaults to user id then ip. */
  by?: 'user' | 'ip' | 'user+ip' | 'device';
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, opts);

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rateLimit: RateLimitService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const key = this.subjectKey(req, opts.by ?? 'user');

    const result = await this.rateLimit.consume({
      bucket: opts.bucket,
      key,
      limit: opts.limit,
      windowSeconds: opts.windowSeconds,
    });

    const res = ctx.switchToHttp().getResponse();
    res.setHeader('x-ratelimit-limit', String(result.limit));
    res.setHeader('x-ratelimit-remaining', String(result.remaining));
    res.setHeader('x-ratelimit-reset', String(result.resetAt));

    if (!result.allowed) {
      throw new HttpException(
        {
          message: 'rate_limited',
          bucket: opts.bucket,
          retryAfter: Math.max(1, result.resetAt - Math.floor(Date.now() / 1000)),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private subjectKey(req: Request, by: NonNullable<RateLimitOptions['by']>): string {
    const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
    const userId = req.user?.id;
    const deviceId = req.user?.deviceId;
    switch (by) {
      case 'ip':
        return `ip:${ip}`;
      case 'user':
        return userId ? `user:${userId}` : `ip:${ip}`;
      case 'user+ip':
        return userId ? `user:${userId}|ip:${ip}` : `ip:${ip}`;
      case 'device':
        return deviceId ? `dev:${deviceId}` : userId ? `user:${userId}` : `ip:${ip}`;
    }
  }
}
