import { registerAs } from '@nestjs/config';

export const redisConfig = registerAs('redis', () => ({
  url: process.env.REDIS_URL ?? 'redis://localhost:6379/0',
  rateLimitDb: parseInt(process.env.REDIS_RATE_LIMIT_DB ?? '1', 10),
  queueDb: parseInt(process.env.REDIS_QUEUE_DB ?? '2', 10),
}));
