import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Env } from '../environment.js';

export const DRIZZLE = Symbol('DRIZZLE');
const PG_POOL = Symbol('PG_POOL');

/** Plain query-builder usage; no relations registered (nothing needs RQB). */
export type Database = NodePgDatabase;

/** Global database module: one pg Pool (max 10) and one drizzle instance per process. */
@Global()
@Module({
  exports: [DRIZZLE],
  providers: [
    {
      inject: [ConfigService],
      provide: PG_POOL,
      useFactory: (config: ConfigService<Env, true>): Pool =>
        new Pool({
          connectionString: config.get('DATABASE_URL', { infer: true }),
          max: 10,
        }),
    },
    {
      inject: [PG_POOL],
      provide: DRIZZLE,
      useFactory: (pool: Pool): Database => drizzle({ client: pool }),
    },
  ],
})
export class DrizzleModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Closes the pool on shutdown; Nest calls this via enableShutdownHooks. */
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
