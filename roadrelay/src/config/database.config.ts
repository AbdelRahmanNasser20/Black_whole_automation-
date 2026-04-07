import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL ?? 'postgres://roadrelay:roadrelay@localhost:5432/roadrelay',
  poolMax: parseInt(process.env.DATABASE_POOL_MAX ?? '20', 10),
  ssl: process.env.DATABASE_SSL === 'true',
  statementTimeoutMs: parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? '5000', 10),
}));
