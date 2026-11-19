import type { SQL } from 'drizzle-orm';
import type { QueryResult, QueryResultRow } from 'pg';

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../src/db/drizzle.module.js';

import * as schema from '../src/db/schema.js';
import { seedLanguages } from '../src/db/seed.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

/**
 * Raw SQL helper for the integration suite: guards the multi-result union and keeps rows typed.
 * @param db - the drizzle database handle
 * @param statement - the raw SQL to execute
 * @returns the typed rows
 */
async function rawRows<T extends QueryResultRow>(db: Database, statement: SQL): Promise<T[]> {
  const result = (await db.execute(statement)) as QueryResult<Record<string, unknown>>;
  if (result == null || typeof result !== 'object' || !Array.isArray(result.rows)) {
    throw new Error('unexpected shape from pg driver');
  }
  // pg returns plain objects for the static SQL text used in this suite;
  // the assertions below check the actual field types anyway.
  return result.rows as unknown as T[];
}

describe('database layer (throwaway PostgreSQL 17)', () => {
  let cluster: TempCluster;
  let pool: Pool;
  let db: Database;

  beforeAll(async () => {
    cluster = startTempCluster();
    process.env.DATABASE_URL = cluster.url();
    process.env.SESSION_SECRET = 'a'.repeat(64);
    pool = new Pool({ connectionString: cluster.url() });
    db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
  }, 60_000);

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    delete process.env.SESSION_SECRET;
    await pool.end();
    cluster.destroy();
  });

  it('applies the committed migration on an empty database', async () => {
    const rows = await rawRows<{ table_name: string }>(
      db,
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      'ai_cache',
      'ai_message_prompts',
      'ai_messages',
      'languages',
      'translations',
    ]);
  });

  it('seeds 184 languages idempotently and derives isSource', async () => {
    const first = await seedLanguages(db);
    const second = await seedLanguages(db);
    expect(first.upserted).toBe(184);
    expect(second.upserted).toBe(184);

    const count = await rawRows<{ n: number }>(db, sql`select count(*)::int as n from languages`);
    expect(count[0]?.n).toBe(184);

    const english = await rawRows<{ is_source: boolean }>(
      db,
      sql`select is_source from languages where iso639_1 = 'en'`,
    );
    const french = await rawRows<{ is_source: boolean }>(
      db,
      sql`select is_source from languages where iso639_1 = 'fr'`,
    );
    expect(english[0]?.is_source).toBe(true);
    expect(french[0]?.is_source).toBe(false);
  });

  it('enforces translations(language_id, key) uniqueness', async () => {
    const languages = await rawRows<{ id: string }>(
      db,
      sql`select id from languages where iso639_1 = 'fr'`,
    );
    const languageId = languages[0]?.id;
    if (!languageId) throw new Error('seed did not insert French');

    await db.execute(
      sql`insert into translations (language_id, namespace, key, text) values (${languageId}, 'dynamic', 'k1', 'Bonjour')`,
    );

    await expect(
      db.execute(
        sql`insert into translations (language_id, namespace, key, text) values (${languageId}, 'dynamic', 'k1', 'Bonjour again')`,
      ),
    ).rejects.toThrow();
  });

  it('cascades ai_message_prompts when the parent ai_message is deleted', async () => {
    const inserted = await db
      .insert(schema.aiMessages)
      .values({
        model: 'bonsai-2:2b',
        provider: 'ollama',
        response: 'Bonjour',
        status: 'completed',
      })
      .returning({ id: schema.aiMessages.id });
    const message = inserted[0];
    if (!message) throw new Error('insert returned no row');

    await db
      .insert(schema.aiMessagePrompts)
      .values({ messageId: message.id, prompt: 'hello', role: 'human' });

    const before = await rawRows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ai_message_prompts`,
    );
    expect(before[0]?.n).toBe(1);

    await db.execute(sql`delete from ai_messages where id = ${message.id}`);
    const after = await rawRows<{ n: number }>(
      db,
      sql`select count(*)::int as n from ai_message_prompts`,
    );
    expect(after[0]?.n).toBe(0);
  });

  it('runs the exported seed main() end to end', async () => {
    const { main } = await import('../src/db/seed.js');
    await expect(main()).resolves.toBeUndefined();
  });

  it('runs the exported migrate main() end to end', async () => {
    const { main } = await import('../src/db/migrate.js');
    await expect(main()).resolves.toBeUndefined();
  });

  it('serves the hot (language_id, key) lookup from the unique index', async () => {
    const found = await rawRows<{ id: string }>(
      db,
      sql`select id from languages where iso639_1 = 'en'`,
    );
    const row = found[0];
    if (!row) throw new Error('seed did not insert English');

    // The planner switches to the unique index once the table is not tiny.
    await db.execute(
      sql`insert into translations (language_id, namespace, key, text) select ${row.id}, 'dynamic', 'bench-' || g, 'x' from generate_series(1, 2000) g`,
    );
    await db.execute(sql`analyze translations`);

    const explained = await rawRows<QueryResultRow>(
      db,
      sql`EXPLAIN (ANALYZE, BUFFERS) SELECT text FROM translations WHERE language_id = ${row.id} AND key = 'bench-1000' AND deleted_at IS NULL`,
    );
    const plan = explained.map((r) => Object.values(r).join('\n')).join('\n');
    expect(plan).toContain('translations_language_key_unique');
    expect(plan).toContain('Index');
  });
});
