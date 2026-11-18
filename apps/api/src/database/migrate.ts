import path from 'node:path';

import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

import { validateEnv } from '../config/env';

/**
 * One-shot migration runner (`npm run db:migrate`). Applies the SQL files in
 * `drizzle/` in order. Safe to run repeatedly; drizzle tracks applied
 * migrations in the `__drizzle_migrations` table.
 *
 * Called explicitly by the thin `apps/api/bin/db-migrate.mjs` wrapper.
 */
export async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', '..', 'drizzle') });
    Logger.log('migrations applied', 'Migrate');
  } finally {
    await pool.end();
  }
}
