import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants';
import { seedLanguages } from '../src/database/seed';
import { startTempCluster, type TempCluster } from './pg-temp';

describe('languages REST (integration, throwaway PostgreSQL)', () => {
  let cluster: TempCluster;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_languages_test');
    process.env.DATABASE_URL = cluster.url();
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

  async function createLanguage(body: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: '/api/languages', payload: body });
  }

  it('lists the seeded catalogue with default pagination', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/languages' });
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
      const response = await app.inject({ method: 'GET', url: `/api/languages?${query}` });
      expect(response.statusCode, query).toBe(400);
    }
  });

  it('finds Arabic via q and treats LIKE wildcards literally', async () => {
    const hit = await app.inject({ method: 'GET', url: '/api/languages?q=arabic' });
    expect(hit.statusCode).toBe(200);
    const hitBody = hit.json() as { items: Array<{ iso6391: string }> };
    expect(hitBody.items.some((item) => item.iso6391 === 'ar')).toBe(true);

    const percent = await app.inject({ method: 'GET', url: '/api/languages?q=%25' });
    expect(percent.statusCode).toBe(200);
    expect((percent.json() as { items: unknown[] }).items).toHaveLength(0);

    const underscore = await app.inject({ method: 'GET', url: '/api/languages?q=_' });
    expect(underscore.statusCode).toBe(200);
    expect((underscore.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('creates, reads, updates and soft-deletes a language', async () => {
    const created = await createLanguage({
      name: 'Testese',
      nativeName: 'Teste',
      iso6391: 'tz',
      dir: 'ltr',
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json() as { id: string; iso6391: string };
    expect(createdBody.iso6391).toBe('tz');

    const fetched = await app.inject({ method: 'GET', url: `/api/languages/${createdBody.id}` });
    expect(fetched.statusCode).toBe(200);

    const duplicated = await createLanguage({
      name: 'Testese again',
      nativeName: 'Teste',
      iso6391: 'tz',
      dir: 'rtl',
    });
    expect(duplicated.statusCode).toBe(409);

    const updated = await app.inject({
      method: 'PATCH',
      url: `/api/languages/${createdBody.id}`,
      payload: { dir: 'rtl' },
    });
    expect(updated.statusCode).toBe(200);
    expect((updated.json() as { dir: string }).dir).toBe('rtl');

    const nothingChanged = await app.inject({
      method: 'PATCH',
      url: `/api/languages/${createdBody.id}`,
      payload: { dir: 'rtl' },
    });
    expect(nothingChanged.statusCode).toBe(400);

    const deleted = await app.inject({ method: 'DELETE', url: `/api/languages/${createdBody.id}` });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/api/languages/${createdBody.id}` });
    expect(gone.statusCode).toBe(404);

    const goneAgain = await app.inject({
      method: 'DELETE',
      url: `/api/languages/${createdBody.id}`,
    });
    expect(goneAgain.statusCode).toBe(404);
  });

  it('rejects an empty PATCH body at the schema boundary', async () => {
    const created = await createLanguage({
      name: 'Boundaryese',
      nativeName: 'B',
      iso6391: 'bx',
      dir: 'ltr',
    });
    const id = (created.json() as { id: string }).id;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/languages/${id}`,
      payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns 409 when a PATCH moves iso6391 onto a taken code', async () => {
    await createLanguage({ name: 'conflict-a', nativeName: 'a', iso6391: 'ac', dir: 'ltr' });
    const b = await createLanguage({
      name: 'conflict-b',
      nativeName: 'b',
      iso6391: 'bc',
      dir: 'ltr',
    });
    const bId = (b.json() as { id: string }).id;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/languages/${bId}`,
      payload: { iso6391: 'ac' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('hides soft-deleted rows by default and shows them with onlyDeleted', async () => {
    const created = await createLanguage({
      name: 'gonebutSeen',
      nativeName: 'gone',
      iso6391: 'gb',
      dir: 'ltr',
    });
    const id = (created.json() as { id: string }).id;
    await app.inject({ method: 'DELETE', url: `/api/languages/${id}` });

    const visible = await app.inject({ method: 'GET', url: '/api/languages?q=gonebutSeen' });
    expect((visible.json() as { items: unknown[] }).items).toHaveLength(0);

    const deletedOnly = await app.inject({
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
        name,
        nativeName: `${name}-native`,
        iso6391: name.slice(-1) + 'q',
        dir: 'ltr',
      });
    }

    // Filter down to the five new rows and page through them two at a time.
    const collected: string[] = [];
    let url = '/api/languages?q=zzwalk&pageSize=2&orderBy=asc';
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        items: Array<{ name: string }>;
        next: { lastId: string; lastCreatedAt: string } | null;
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
