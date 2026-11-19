import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/constants/app.js';
import { seedLanguages } from '../src/db/seed.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

describe('languages REST (integration, throwaway PostgreSQL)', () => {
  let cluster: TempCluster;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_languages_test');
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    delete process.env.PG_BOSS_URL;
    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    await seedLanguages(db);
    await pool.end();
  }, 60_000);

  afterAll(() => {
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

  /**
   * Calls POST /api/languages and returns the raw injected response.
   * @param body - the create body
   * @returns the raw response
   */
  async function createLanguage(body: Record<string, unknown>) {
    return app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: body,
      url: '/api/languages',
    });
  }

  it('lists the seeded catalogue with default pagination', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/languages',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ iso6391: string }>; next: unknown };
    expect(body.items).toHaveLength(20);
    expect(body.next).not.toBeNull();
  });

  it('validates pagination params at the boundary', async () => {
    for (const query of [
      'pageSize=0',
      'pageSize=101',
      'orderBy=banana',
      'orderBy=',
      'lastId=not-a-uuid',
    ]) {
      const response = await app.inject({
        headers: basicAuthHeaders(),
        method: 'GET',
        url: `/api/languages?${query}`,
      });
      expect(response.statusCode, query).toBe(400);
    }
  });

  it('finds Arabic via q and treats LIKE wildcards literally', async () => {
    const hit = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/languages?q=arabic',
    });
    expect(hit.statusCode).toBe(200);
    const hitBody = hit.json() as { items: Array<{ iso6391: string }> };
    expect(hitBody.items.some((item) => item.iso6391 === 'ar')).toBe(true);

    const percent = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/languages?q=%25',
    });
    expect(percent.statusCode).toBe(200);
    expect((percent.json() as { items: unknown[] }).items).toHaveLength(0);

    const underscore = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/languages?q=_',
    });
    expect(underscore.statusCode).toBe(200);
    expect((underscore.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('creates, reads, updates and soft-deletes a language', async () => {
    const created = await createLanguage({
      dir: 'ltr',
      iso6391: 'tz',
      name: 'Testese',
      nativeName: 'Teste',
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { id: string; iso6391: string };
    expect(createdBody.iso6391).toBe('tz');

    const fetched = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: `/api/languages/${createdBody.id}`,
    });
    expect(fetched.statusCode).toBe(200);

    const duplicated = await createLanguage({
      dir: 'rtl',
      iso6391: 'tz',
      name: 'Testese again',
      nativeName: 'Teste',
    });
    expect(duplicated.statusCode).toBe(409);

    const updated = await app.inject({
      headers: basicAuthHeaders(),
      method: 'PATCH',
      payload: { dir: 'rtl' },
      url: `/api/languages/${createdBody.id}`,
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { dir: string }).dir).toBe('rtl');

    const nothingChanged = await app.inject({
      headers: basicAuthHeaders(),
      method: 'PATCH',
      payload: { dir: 'rtl' },
      url: `/api/languages/${createdBody.id}`,
    });
    expect(nothingChanged.statusCode).toBe(400);

    const deleted = await app.inject({
      headers: basicAuthHeaders(),
      method: 'DELETE',
      url: `/api/languages/${createdBody.id}`,
    });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: `/api/languages/${createdBody.id}`,
    });
    expect(gone.statusCode).toBe(404);

    const goneAgain = await app.inject({
      headers: basicAuthHeaders(),
      method: 'DELETE',
      url: `/api/languages/${createdBody.id}`,
    });
    expect(goneAgain.statusCode).toBe(404);
  });

  it('rejects an empty PATCH body at the schema boundary', async () => {
    const created = await createLanguage({
      dir: 'ltr',
      iso6391: 'bx',
      name: 'Boundaryese',
      nativeName: 'B',
    });
    const id = (created.json() as { id: string }).id;
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'PATCH',
      payload: {},
      url: `/api/languages/${id}`,
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 409 when a PATCH moves iso6391 onto a taken code', async () => {
    await createLanguage({ dir: 'ltr', iso6391: 'ac', name: 'conflict-a', nativeName: 'a' });
    const b = await createLanguage({
      dir: 'ltr',
      iso6391: 'bc',
      name: 'conflict-b',
      nativeName: 'b',
    });
    const bId = (b.json() as { id: string }).id;
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'PATCH',
      payload: { iso6391: 'ac' },
      url: `/api/languages/${bId}`,
    });
    expect(response.statusCode).toBe(409);
  });

  it('hides soft-deleted rows by default and shows them with onlyDeleted', async () => {
    const created = await createLanguage({
      dir: 'ltr',
      iso6391: 'gb',
      name: 'gonebutSeen',
      nativeName: 'gone',
    });
    const id = (created.json() as { id: string }).id;
    await app.inject({
      headers: basicAuthHeaders(),
      method: 'DELETE',
      url: `/api/languages/${id}`,
    });

    const visible = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/languages?q=gonebutSeen',
    });
    expect((visible.json() as { items: unknown[] }).items).toHaveLength(0);

    const deletedOnly = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/languages?q=gonebutSeen&onlyDeleted=true',
    });
    const body = deletedOnly.json() as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.id).toBe(id);
  });

  it('walks keyset pages without duplicates', async () => {
    for (const name of ['zzwalk-a', 'zzwalk-b', 'zzwalk-c', 'zzwalk-d', 'zzwalk-e']) {
      await createLanguage({
        dir: 'ltr',
        iso6391: name.slice(-1) + 'q',
        name,
        nativeName: `${name}-native`,
      });
    }

    // Filter down to the five new rows and page through them two at a time.
    const collected: string[] = [];
    let url = '/api/languages?q=zzwalk&pageSize=2&orderBy=asc';
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        items: Array<{ name: string }>;
        next: null | { lastCreatedAt: string; lastId: string };
      };
      collected.push(...body.items.map((item) => item.name));
      if (!body.next) break;
      url = `/api/languages?q=zzwalk&pageSize=2&orderBy=asc&lastId=${body.next.lastId}&lastCreatedAt=${encodeURIComponent(body.next.lastCreatedAt)}`;
    }
    expect([...collected].sort()).toEqual([
      'zzwalk-a',
      'zzwalk-b',
      'zzwalk-c',
      'zzwalk-d',
      'zzwalk-e',
    ]);
    expect(new Set(collected).size).toBe(collected.length);
  });
});
