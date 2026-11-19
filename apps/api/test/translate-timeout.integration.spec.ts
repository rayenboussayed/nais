import path from 'node:path';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants.js';
import * as schema from '../src/database/schema.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';
import { startOllamaStub, type OllamaStub } from './ollama-stub.js';

// Module scope: the test wants the model budget at 100ms. Assigned before
// AppModule is imported (lazily, inside beforeEach), so the config factory
// captures it.
process.env.OLLAMA_TIMEOUT_MS = '100';

describe('translate with a hanging model (integration)', () => {
  let cluster: TempCluster;
  let stub: OllamaStub;
  const originalOllamaTimeout = process.env.OLLAMA_TIMEOUT_MS;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOllamaUrl = process.env.OLLAMA_BASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_translate_timeout_test');
    // Model answers after far longer than the 100ms budget configured above.
    stub = await startOllamaStub({ delayMs: 2_000 });
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    process.env.OLLAMA_BASE_URL = stub.url;
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    const { seedLanguages } = await import('../src/database/seed.js');
    await seedLanguages(db);
    await pool.end();
  }, 60_000);

  afterAll(async () => {
    if (originalOllamaTimeout === undefined) delete process.env.OLLAMA_TIMEOUT_MS;
    else process.env.OLLAMA_TIMEOUT_MS = originalOllamaTimeout;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalOllamaUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalOllamaUrl;
    delete process.env.PG_BOSS_URL;
    await stub.close();
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

  it('answers 504 with a constant message and audits the failure', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      url: '/api/translate',
      payload: { text: 'this hangs', targetLanguage: 'fr' },
    });
    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({ statusCode: 504, message: 'Translation timed out' });

    const pool = new Pool({ connectionString: cluster.url() });
    try {
      const db = drizzle({ client: pool });
      const messages = await db
        .select()
        .from(schema.aiMessages)
        .where(eq(schema.aiMessages.status, 'failed'))
        .limit(1);
      expect(messages.length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  }, 30_000);
});
