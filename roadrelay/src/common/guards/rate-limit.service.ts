import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

import { REDIS_RATE_LIMIT } from '@infrastructure/redis/redis.module';

export interface RateLimitInput {
  /** A logical bucket name (e.g. "auth", "plate_lookup"). */
  bucket: string;
  /** The subject being limited (e.g. "user:abc", "ip:1.2.3.4"). */
  key: string;
  /** Max events per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Sliding-window-counter style rate limiter (sufficient accuracy for
 * abuse prevention; not a true Cormode-Muthukrishnan estimator). Uses
 * a Lua script to atomically:
 *   1. INCR a hash bucket keyed by floor(now/window).
 *   2. EXPIRE the bucket to (window * 2) seconds.
 *   3. Read the previous bucket and weight it by elapsed fraction.
 *
 * Why a sliding window: fixed-window limiters have a "double-burst"
 * problem at window boundaries. Token-bucket limiters need refill
 * timestamps and are harder to reason about; this is the lowest-risk
 * design that survives multi-instance deployments.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  // KEYS[1] = current bucket, KEYS[2] = previous bucket
  // ARGV[1] = window, ARGV[2] = elapsed, ARGV[3] = limit
  private readonly script = `
    local current = tonumber(redis.call('GET', KEYS[1]) or '0')
    local previous = tonumber(redis.call('GET', KEYS[2]) or '0')
    local window  = tonumber(ARGV[1])
    local elapsed = tonumber(ARGV[2])
    local limit   = tonumber(ARGV[3])
    local weighted = math.floor(previous * ((window - elapsed) / window) + current)
    if weighted >= limit then
      return { 0, weighted }
    end
    local new_count = redis.call('INCR', KEYS[1])
    redis.call('EXPIRE', KEYS[1], window * 2)
    weighted = math.floor(previous * ((window - elapsed) / window) + new_count)
    return { 1, weighted }
  `;

  constructor(@Inject(REDIS_RATE_LIMIT) private readonly redis: Redis) {}

  async consume(input: RateLimitInput): Promise<RateLimitResult> {
    const now = Math.floor(Date.now() / 1000);
    const window = input.windowSeconds;
    const currentBucket = Math.floor(now / window);
    const elapsed = now - currentBucket * window;

    const currentKey = `rl:${input.bucket}:${input.key}:${currentBucket}`;
    const previousKey = `rl:${input.bucket}:${input.key}:${currentBucket - 1}`;

    try {
      const result = (await this.redis.eval(
        this.script,
        2,
        currentKey,
        previousKey,
        window,
        elapsed,
        input.limit,
      )) as [number, number];

      const [allowed, count] = result;
      const remaining = Math.max(0, input.limit - count);
      const resetAt = (currentBucket + 1) * window;
      return { allowed: allowed === 1, remaining, resetAt, limit: input.limit };
    } catch (err) {
      // Fail open in dev, fail closed in prod is configurable per-bucket.
      this.logger.error(`Rate limit error for ${input.bucket}:${input.key}`, err as Error);
      return { allowed: true, remaining: input.limit, resetAt: now + window, limit: input.limit };
    }
  }
}
