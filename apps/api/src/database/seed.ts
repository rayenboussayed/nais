import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { validateEnv } from '../config/env';

import type { Database } from './drizzle.module';
import { languages } from './schema';
import { languagesSeed } from './languages.seed';

/** Rows per upsert statement; multi-row VALUES keeps 184 inserts to two statements. */
const CHUNK = 100;

export interface SeedResult {
  /** Number of rows inserted or updated. */
  upserted: number;
}

/**
 * Idempotently upserts the 184 ISO 639-1 languages by their `iso639_1`
 * unique key. Re-running is safe and converges to the seed payload.
 *
 * @param db - drizzle instance over the app schema
 * @returns counts upserted this run
 */
export async function seedLanguages(db: Database): Promise<SeedResult> {
  let upserted = 0;
  for (let offset = 0; offset < languagesSeed.length; offset += CHUNK) {
    const chunk = languagesSeed.slice(offset, offset + CHUNK).map((language) => ({
      ...language,
      isSource: language.iso6391 === 'en',
    }));

    const rows = await db
      .insert(languages)
      .values(chunk)
      .onConflictDoUpdate({
        target: languages.iso6391,
        set: {
          name: sql`excluded.name`,
          nativeName: sql`excluded.native_name`,
          dir: sql`excluded.dir`,
          isSource: sql`excluded.is_source`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: languages.id });
    upserted += rows.length;
  }
  return { upserted };
}

/**
 * Runs the seed against the DATABASE_URL from the environment.
 * Called explicitly by `bin/db-seed.mjs` and by the integration suite.
 */
export async function main(): Promise<void> {
  const env = validateEnv(process.env);
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const db = drizzle({ client: pool });
    const { upserted } = await seedLanguages(db);
    Logger.log(`languages seed complete: ${upserted} rows upserted`, 'Seed');
  } finally {
    await pool.end();
  }
}
