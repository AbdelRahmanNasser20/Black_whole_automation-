import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const pool = new Pool({
          connectionString: config.get<string>('database.url'),
          max: config.get<number>('database.poolMax'),
          ssl: config.get<boolean>('database.ssl') ? { rejectUnauthorized: false } : false,
          statement_timeout: config.get<number>('database.statementTimeoutMs'),
        });
        pool.on('error', (err) => {
          // eslint-disable-next-line no-console
          console.error('PG pool error', err);
        });
        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule {}
