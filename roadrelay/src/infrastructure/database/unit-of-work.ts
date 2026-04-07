import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from './database.module';

/**
 * UnitOfWork wraps a callback in a single Postgres transaction with
 * SERIALIZABLE-by-default isolation. Use it for any multi-statement
 * mutation that must be atomic (e.g. accept contact request +
 * create relay session + write audit log).
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async run<T>(
    handler: (client: PoolClient) => Promise<T>,
    isolation: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' = 'READ COMMITTED',
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${isolation}`);
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
