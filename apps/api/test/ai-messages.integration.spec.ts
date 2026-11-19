import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants';
import * as schema from '../src/database/schema';
import { startTempCluster, type TempCluster } from './pg-temp';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth';

describe('ai-messages REST (integration, throwaway PostgreSQL)', () => {
  let cluster: TempCluster;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_ai_messages_test');
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    await db.insert(schema.aiMessages).values([
      {
        provider: 'ollama',
        model: 'bonsai-2:2b',
        status: 'completed',
        response: 'Bonjour le monde',
        usage: { inputTokens: 10, outputTokens: 4 },
      },
      {
        provider: 'ollama',
        model: 'bonsai-2:2b',
        status: 'failed',
        response: null,
        usage: null,
      },
      {
        provider: 'openai',
        model: 'gpt-test-1',
        status: 'completed',
        response: 'Hello world',
        usage: null,
      },
    ]);
    const [first] = await db
      .select({ id: schema.aiMessages.id })
      .from(schema.aiMessages)
      .orderBy(schema.aiMessages.createdAt)
      .limit(1);
    if (!first) throw new Error('seed returned no message');
    await db.insert(schema.aiMessagePrompts).values([
      { messageId: first.id, role: 'system', prompt: 'You are a translator.' },
      { messageId: first.id, role: 'human', prompt: 'Translate: hello' },
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

  it('walks keyset pages in ascending order without duplicates', async () => {
    const collected: string[] = [];
    let url = '/api/ai-messages?pageSize=2&orderBy=asc';
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url });
      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        items: Array<{ id: string }>;
        next: { lastId: string; lastCreatedAt: string } | null;
      };
      collected.push(...body.items.map((item) => item.id));
      if (!body.next) break;
      url = `/api/ai-messages?pageSize=2&orderBy=asc&lastId=${body.next.lastId}&lastCreatedAt=${encodeURIComponent(body.next.lastCreatedAt)}`;
    }
    expect(new Set(collected).size).toBe(collected.length);
    expect(collected.length).toBeGreaterThanOrEqual(3);
  });

  it('lists the audit rows, newest first', async () => {
    const response = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<{ provider: string; model: string }> };
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    expect(body.items.some((item) => item.model === 'gpt-test-1')).toBe(true);
  });

  it('searches q across provider, model and response', async () => {
    const byModel = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages?q=gpt-test' });
    expect((byModel.json() as { items: unknown[] }).items).toHaveLength(1);

    const byResponse = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages?q=bonjour' });
    expect((byResponse.json() as { items: unknown[] }).items).toHaveLength(1);

    const byProvider = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages?q=openai' });
    expect((byProvider.json() as { items: unknown[] }).items).toHaveLength(1);

    const none = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages?q=zzz-not-here' });
    expect((none.json() as { items: unknown[] }).items).toHaveLength(0);
  });

  it('serves one row and its prompts, or 404', async () => {
    const all = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages' });
    const items = (all.json() as { items: Array<{ id: string; response: string | null }> }).items;
    const withResponse = items.find((item) => item.response === 'Bonjour le monde');
    if (!withResponse) throw new Error('seeded message not found');

    const one = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: `/api/ai-messages/${withResponse.id}` });
    expect(one.statusCode).toBe(200);
    expect((one.json() as { status: string }).status).toBe('completed');

    const prompts = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: `/api/ai-messages/${withResponse.id}/prompts`,
    });
    expect(prompts.statusCode).toBe(200);
    const promptBodies = (prompts.json() as Array<{ role: string }>).map((prompt) => prompt.role);
    expect(promptBodies).toEqual(['system', 'human']);

    const missing = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/ai-messages/10000000-0000-4000-8000-000000000000',
    });
    expect(missing.statusCode).toBe(404);

    const missingPrompts = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/ai-messages/10000000-0000-4000-8000-000000000000/prompts',
    });
    expect(missingPrompts.statusCode).toBe(404);
  });

  it('soft-deletes with 204 then hides the row, 404 on re-delete', async () => {
    const all = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: '/api/ai-messages' });
    const items = (all.json() as { items: Array<{ id: string }> }).items;
    const target = items[0];
    if (!target) throw new Error('no message to delete');

    const deleted = await app.inject({ headers: basicAuthHeaders(), method: 'DELETE', url: `/api/ai-messages/${target.id}` });
    expect(deleted.statusCode).toBe(204);

    const gone = await app.inject({ headers: basicAuthHeaders(), method: 'GET', url: `/api/ai-messages/${target.id}` });
    expect(gone.statusCode).toBe(404);

    const goneAgain = await app.inject({ headers: basicAuthHeaders(), method: 'DELETE', url: `/api/ai-messages/${target.id}` });
    expect(goneAgain.statusCode).toBe(404);

    const onlyDeleted = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/ai-messages?onlyDeleted=true',
    });
    const rows = (onlyDeleted.json() as { items: Array<{ id: string }> }).items;
    expect(rows.some((row) => row.id === target.id)).toBe(true);
  });
});
