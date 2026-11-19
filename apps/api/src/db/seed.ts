import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import type { Database } from './drizzle.module.js';

import { validateEnv } from '../environment.js';
import { languagesSeed } from './languages.seed.js';
import { languages } from './schema.js';

/** Rows per upsert statement; multi-row VALUES keeps 184 inserts to two statements. */
const CHUNK = 100;

export interface SeedResult {
  /** Number of rows inserted or updated. */
  upserted: number;
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

/**
 * Idempotently upserts the 184 ISO 639-1 languages by their `iso639_1`
 * unique key. Re-running is safe and converges to the seed payload.
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
        set: {
          dir: sql`excluded.dir`,
          isSource: sql`excluded.is_source`,
          name: sql`excluded.name`,
          nativeName: sql`excluded.native_name`,
          updatedAt: sql`now()`,
        },
        target: languages.iso6391,
      })
      .returning({ id: languages.id });
    upserted += rows.length;
  }
  return { upserted };
}
