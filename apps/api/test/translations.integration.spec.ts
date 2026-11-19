import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants';
import * as schema from '../src/database/schema';
import { seedLanguages } from '../src/database/seed';
import { translationKeyFor } from '../src/common/key';
import { startTempCluster, type TempCluster } from './pg-temp';

describe('translations REST (integration, throwaway PostgreSQL)', () => {
  let cluster: TempCluster;
  let frenchId = '';
  let englishId = '';
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_translations_test');
    process.env.DATABASE_URL = cluster.url();
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    await seedLanguages(db);

    const lookUp = async (iso: string) => {
      const rows = await db
        .select({ id: schema.languages.id })
        .from(schema.languages)
        .where(eq(schema.languages.iso6391, iso))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error(`seed did not insert ${iso}`);
      return row.id;
    };
    frenchId = await lookUp('fr');
    englishId = await lookUp('en');

    await db.insert(schema.translations).values([
      { languageId: frenchId, namespace: 'static', key: 'home.title', text: 'Accueil' },
      { languageId: englishId, namespace: 'static', key: 'home.title', text: 'Home' },
      {
        languageId: frenchId,
        namespace: 'dynamic',
        key: translationKeyFor('hello'),
        text: 'bonjour',
      },
    ]);
    await pool.end();
  }, 60_000);

  afterAll(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    delete process.env.PG_BOSS_URL;
    cluster.destroy();
  });

  let app: NestFastifyApplication;

  beforeEach(async () => {
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  async function createTranslation(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/translations', payload: body });
  }

  it('lists across languages and filters by languageId and namespace', async () => {
    const all = await app.inject({ method: 'GET', url: '/api/translations' });
    expect((all.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(3);

    const french = await app.inject({
      method: 'GET',
      url: `/api/translations?languageId=${frenchId}`,
    });
    expect((french.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(2);

    const frenchStatic = await app.inject({
      method: 'GET',
      url: `/api/translations?languageId=${frenchId}&namespace=static`,
    });
    const staticItems = (frenchStatic.json() as { items: Array<{ key: string }> }).items;
    expect(staticItems).toHaveLength(1);

    const frenchDynamic = await app.inject({
      method: 'GET',
      url: `/api/translations?languageId=${frenchId}&namespace=dynamic`,
    });
    expect((frenchDynamic.json() as { items: unknown[] }).items).toHaveLength(1);
  });

  it('validates query params at the boundary', async () => {
    for (const query of [
      `languageId=not-a-uuid`,
      'namespace=banana',
      'lastId=not-a-uuid',
      `lastCreatedAt=2026-11-18T00:00:00.000000+00:00`,
      'pageSize=0',
      'pageSize=101',
    ]) {
      const response = await app.inject({ method: 'GET', url: `/api/translations?${query}` });
      expect(response.statusCode, query).toBe(400);
    }
  });

  it('derives the key for dynamic rows and stores static rows as given', async () => {
    const dynamic = await createTranslation({
      namespace: 'dynamic',
      languageId: frenchId,
      text: 'Good morning',
    });
    expect(dynamic.statusCode).toBe(201);
    const dynamicBody = dynamic.json() as { key: string; namespace: string };
    expect(dynamicBody.namespace).toBe('dynamic');
    expect(dynamicBody.key).toBe(translationKeyFor('Good morning'));

    const staticCreated = await createTranslation({
      namespace: 'static',
      languageId: frenchId,
      text: 'Bonjour aussi',
      key: 'greeting.also',
    });
    expect(staticCreated.statusCode).toBe(201);
    expect((staticCreated.json() as { key: string }).key).toBe('greeting.also');
  });

  it('returns 409 on key collision in the same language', async () => {
    const created = await createTranslation({
      namespace: 'static',
      languageId: frenchId,
      text: 'Accueil 2',
      key: 'home.title',
    });
    expect(created.statusCode).toBe(409);
  });

  it('creates a static row under a parent and rejects a missing parent', async () => {
    const parent = await createTranslation({
      namespace: 'static',
      languageId: frenchId,
      text: 'Parent row',
      key: 'parent.row',
    });
    const parentId = (parent.json() as { id: string }).id;

    const child = await createTranslation({
      namespace: 'static',
      languageId: englishId,
      text: 'Child row',
      key: 'child.row',
      parentId,
    });
    expect(child.statusCode).toBe(201);
    expect((child.json() as { parentId: string | null }).parentId).toBe(parentId);

    const orphan = await createTranslation({
      namespace: 'static',
      languageId: englishId,
      text: 'Orphan',
      key: 'orphan.row',
      parentId: '10000000-0000-4000-8000-000000000000',
    });
    expect(orphan.statusCode).toBe(400);
  });

  it('PATCH updates, 400 on no-op, 404 on missing, 409 on key collision', async () => {
    const all = await app.inject({
      method: 'GET',
      url: `/api/translations?languageId=${frenchId}&namespace=static`,
    });
    const items = (all.json() as { items: Array<{ id: string; key: string }> }).items;
    const target = items.find((item) => item.key === 'home.title');
    if (!target) throw new Error('seeded row not found');

    const unchanged = await app.inject({
      method: 'PATCH',
      url: `/api/translations/${target.id}`,
      payload: { text: 'Accueil' },
    });
    expect(unchanged.statusCode).toBe(400);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/translations/${target.id}`,
      payload: { text: 'Accueil !' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { text: string }).text).toBe('Accueil !');

    const other = await createTranslation({
      namespace: 'static',
      languageId: frenchId,
      text: 'Other row',
      key: 'other.row',
    });
    const otherId = (other.json() as { id: string }).id;
    const collision = await app.inject({
      method: 'PATCH',
      url: `/api/translations/${otherId}`,
      payload: { key: 'home.title' },
    });
    expect(collision.statusCode).toBe(409);

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/translations/10000000-0000-4000-8000-000000000000',
      payload: { text: 'nope' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('walks keyset pages without duplicates', async () => {
    const collected: string[] = [];
    let url = '/api/translations?pageSize=2&orderBy=asc&namespace=static';
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        items: Array<{ id: string }>;
        next: { lastId: string; lastCreatedAt: string } | null;
      };
      collected.push(...body.items.map((item) => item.id));
      if (!body.next) break;
      url = `/api/translations?pageSize=2&orderBy=asc&namespace=static&lastId=${body.next.lastId}&lastCreatedAt=${encodeURIComponent(body.next.lastCreatedAt)}`;
    }
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected.length).toBeGreaterThanOrEqual(4);
  });

  it('lookups by (languageId, key) hit and miss without erroring', async () => {
    const { TranslationsService } = await import('../src/translations/translations.service.js');

    const pool = new Pool({ connectionString: cluster.url() });
    try {
      const db = drizzle({ client: pool });
      const service = new TranslationsService(db);
      const hit = await service.findByLanguageAndKey(frenchId, translationKeyFor('hello'));
      expect(hit?.text).toBe('bonjour');

      const miss = await service.findByLanguageAndKey(frenchId, 'no-such-key');
      expect(miss).toBeNull();
    } finally {
      await pool.end();
    }
  });

  it('soft-deletes with 204, hides the row, 404 on re-delete, shows it under onlyDeleted', async () => {
    const created = await createTranslation({
      namespace: 'static',
      languageId: englishId,
      text: 'Delete me',
      key: 'to.delete.row',
    });
    const id = (created.json() as { id: string }).id;

    const deleted = await app.inject({ method: 'DELETE', url: `/api/translations/${id}` });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/api/translations/${id}` });
    expect(gone.statusCode).toBe(404);

    const onlyDeleted = await app.inject({
      method: 'GET',
      url: '/api/translations?onlyDeleted=true&q=to.delete.row',
    });
    const rows = (onlyDeleted.json() as { items: Array<{ id: string }> }).items;
    expect(rows.some((row) => row.id === id)).toBe(true);

    const goneAgain = await app.inject({ method: 'DELETE', url: `/api/translations/${id}` });
    expect(goneAgain.statusCode).toBe(404);
  });
});
