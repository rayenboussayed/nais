import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/constants/app.js';
import * as schema from '../src/db/schema.js';
import { seedLanguages } from '../src/db/seed.js';
import { translationKeyFor } from '../src/utils/key.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';
import { type OllamaStub, startOllamaStub } from './ollama-stub.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

describe('translate pipeline (integration, throwaway PostgreSQL + stubbed Ollama)', () => {
  let cluster: TempCluster;
  let stub: OllamaStub;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOllamaUrl = process.env.OLLAMA_BASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_translate_test');
    stub = await startOllamaStub();
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    process.env.OLLAMA_BASE_URL = stub.url;
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    await seedLanguages(db);
    await pool.end();
  }, 60_000);

  afterAll(async () => {
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
    // Reset the stub so tests don't leak behavior into each other.
    stub.setBehavior({ completion: '[fr] bonjour', delayMs: 0, status: 200 });

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
   * Calls POST /api/translate and returns the raw injected response.
   * @param text - the source text
   * @param targetLanguage - the target language
   * @returns the raw response
   */
  async function translate(text: string, targetLanguage = 'fr') {
    return app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { targetLanguage, text },
      url: '/api/translate',
    });
  }

  it('translates text and persists the translation plus the audit rows', async () => {
    stub.setBehavior({ completion: '[fr] bonjour le monde' });

    const response = await translate('hello world');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ cached: false, text: '[fr] bonjour le monde' });

    const pool = new Pool({ connectionString: cluster.url() });
    try {
      const db = drizzle({ client: pool });
      const languageRows = await db
        .select({ id: schema.languages.id })
        .from(schema.languages)
        .where(eq(schema.languages.iso6391, 'fr'))
        .limit(1);
      const languageId = languageRows[0]?.id;
      if (!languageId) throw new Error('seed did not insert fr');

      const key = translationKeyFor('hello world');
      const stored = await db
        .select()
        .from(schema.translations)
        .where(
          and(
            eq(schema.translations.languageId, languageId),
            eq(schema.translations.key, key),
            isNull(schema.translations.deletedAt),
          ),
        )
        .limit(1);
      expect(stored[0]?.text).toBe('[fr] bonjour le monde');
      expect(stored[0]?.namespace).toBe('dynamic');

      const messages = await db
        .select()
        .from(schema.aiMessages)
        .where(eq(schema.aiMessages.response, '[fr] bonjour le monde'))
        .limit(1);
      const message = messages[0];
      if (!message) throw new Error('audit row not written');
      expect(message.status).toBe('completed');
      expect(message.usage).toMatchObject({ inputTokens: 42, outputTokens: 7 });

      const prompts = await db
        .select()
        .from(schema.aiMessagePrompts)
        .where(eq(schema.aiMessagePrompts.messageId, message.id));
      expect(prompts.map((prompt) => prompt.role).sort()).toEqual(['human', 'system']);
    } finally {
      await pool.end();
    }
  });

  it('serves the cached translation without calling the model again', async () => {
    const first = await translate('hello world, again');
    expect(first.statusCode).toBe(201);
    const hitsBefore = stub.hitCount();

    const second = await translate('hello world, again');
    expect(second.json()).toEqual({ cached: true, text: '[fr] bonjour' });
    expect(stub.hitCount()).toBe(hitsBefore);
  });

  it('caches canonically-equivalent unicode under one key (NFC)', async () => {
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    const first = await translate(composed);
    expect(first.statusCode).toBe(201);

    const hitsBefore = stub.hitCount();
    const second = await translate(decomposed);
    expect(second.statusCode).toBe(201);
    expect(stub.hitCount()).toBe(hitsBefore);

    const pool = new Pool({ connectionString: cluster.url() });
    try {
      const db = drizzle({ client: pool });
      const rows = await db
        .select({ text: schema.translations.text })
        .from(schema.translations)
        .where(eq(schema.translations.key, translationKeyFor(composed)));
      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it('isolates cache entries per language for identical source text', async () => {
    const fr = await translate('identical source text across languages', 'fr');
    const de = await translate('identical source text across languages', 'de');
    expect(fr.statusCode).toBe(201);
    expect(de.statusCode).toBe(201);

    const pool = new Pool({ connectionString: cluster.url() });
    try {
      const db = drizzle({ client: pool });
      const key = translationKeyFor('identical source text across languages');
      const rows = await db
        .select({ languageId: schema.translations.languageId })
        .from(schema.translations)
        .where(eq(schema.translations.key, key));
      expect(rows).toHaveLength(2);
      expect(new Set(rows.map((row) => row.languageId)).size).toBe(2);
    } finally {
      await pool.end();
    }
  });

  it('re-creates a soft-deleted translation on the next call', async () => {
    const created = await translate('resurrect this text');
    expect(created.statusCode).toBe(201);
    const hitsBefore = stub.hitCount();

    const pool = new Pool({ connectionString: cluster.url() });
    let deletedId: string;
    try {
      const db = drizzle({ client: pool });
      const target = await db
        .select({ id: schema.translations.id })
        .from(schema.translations)
        .where(eq(schema.translations.key, translationKeyFor('resurrect this text')))
        .limit(1);
      if (!target[0]) throw new Error('translation row not found');
      deletedId = target[0].id;
    } finally {
      await pool.end();
    }

    const deleted = await app.inject({
      headers: basicAuthHeaders(),
      method: 'DELETE',
      url: `/api/translations/${deletedId}`,
    });
    expect(deleted.statusCode).toBe(204);

    const second = await translate('resurrect this text');
    expect(second.statusCode).toBe(201);
    expect(second.json().cached).toBe(false);
    expect(stub.hitCount()).toBeGreaterThan(hitsBefore);
  });

  it('deduplicates concurrent identical requests into one model call', async () => {
    const hitsBefore = stub.hitCount();
    const [a, b, c] = await Promise.all([
      translate('concurrent hello'),
      translate('concurrent hello'),
      translate('concurrent hello'),
    ]);
    expect(a.statusCode).toBe(201);
    expect(stub.hitCount() - hitsBefore).toBe(1);
    expect(a.json().text).toBe(b.json().text);
    expect(b.json().text).toBe(c.json().text);
  });

  it('answers 502 when the model returns an empty completion', async () => {
    stub.setBehavior({ completion: '' });

    const response = await translate('empty answer case');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ message: 'Translation failed', statusCode: 502 });
  });

  it('returns 502 with a constant message when the model fails, and audits the failure', async () => {
    stub.setBehavior({ delayMs: 0, status: 500 });

    const response = await translate('upstream will fail');
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ message: 'Translation failed', statusCode: 502 });

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
  });

  it('validates input at the boundary and rejects unknown languages with 404', async () => {
    const empty = await translate('   ');
    expect(empty.statusCode).toBe(400);

    const unsupported = await translate('hello', 'xx');
    expect(unsupported.statusCode).toBe(404);
  });
});
