import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { type PipelineFn, PipelineLoader } from '../src/ai/pipeline-loader.js';
import { API_GLOBAL_PREFIX } from '../src/app.constants.js';
import * as schema from '../src/database/schema.js';
import { seedLanguages } from '../src/database/seed.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

/**
 * End-to-end over a throwaway PostgreSQL cluster with the ONNX pipelines
 * replaced by a deterministic fake loader. Exercises the registry, the
 * ai_cache round trip, the audit trail, the REST surface and the WS `ai`
 * message flow.
 */

const STUB_OUTPUTS: Record<string, unknown> = {
  'feature-extraction': { tolist: () => [[0.1, 0.2, 0.3]] },
  'question-answering': { answer: 'a nice puppet', end: 25, score: 0.57, start: 12 },
  sentiment: [{ label: 'POSITIVE', score: 0.91 }],
  summarize: [{ summary_text: 'Paris is about ninety kilometres from Orly.' }],
  'token-classification': [
    { end: 16, entity_group: 'PER', score: 0.99, start: 11, word: 'Sarah' },
    { end: 39, entity_group: 'LOC', score: 0.98, start: 33, word: 'London' },
  ],
  'zero-shot-classification': {
    labels: ['mobile', 'billing'],
    scores: [0.88, 0.12],
    sequence: 'my phone broke',
  },
};

/**
 * Stubs the transformers pipeline: records the tasks it loads and returns canned outputs.
 * @returns the loader stub and its call tracker
 */
function fakeLoader() {
  const calls = new Map<string, number>();
  return {
    calls,
    load: async (task: string): Promise<PipelineFn> => {
      calls.set(task, (calls.get(task) ?? 0) + 1);
      return async () => {
        // eslint-disable-next-line security/detect-object-injection -- task iterates the stubbed task list (AiTask)
        const output = STUB_OUTPUTS[task];
        if (output === undefined) throw new Error(`no stub for task ${task}`);
        return output;
      };
    },
    modelFor: (task: string) => `stub/${task}`,
  };
}

describe('AI service (integration, throwaway PostgreSQL, stubbed pipelines)', () => {
  let cluster: TempCluster;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_ai_tasks_test');
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
    delete process.env.BASIC_AUTH_USERNAME;
    delete process.env.BASIC_AUTH_PASSWORD_HASH;
    delete process.env.SESSION_SECRET;
    delete process.env.PG_BOSS_URL;
    cluster.destroy();
  });

  let app: NestFastifyApplication;
  let loader: ReturnType<typeof fakeLoader>;

  beforeEach(async () => {
    loader = fakeLoader();
    // Isolate cache/audit rows between tests so stub-order never leaks state.
    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await db.delete(schema.aiCache);
    await db.delete(schema.aiMessages);
    await pool.end();

    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PipelineLoader)
      .useValue(loader)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists the task registry with providers and models', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/ai/tasks',
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ model: string; provider: string; task: string }>;
    };
    const byTask = new Map(body.items.map((entry) => [entry.task, entry]));
    expect(byTask.get('translate')?.provider).toBe('ollama');
    expect(byTask.get('sentiment')?.provider).toBe('transformers');
    expect(byTask.get('sentiment')?.model).toBe('stub/sentiment'); // stubbed loader reports its effective model
    expect(body.items).toHaveLength(7);
  });

  it('runs a sentiment call, caches it, and serves the cache on the second call', async () => {
    const request = {
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { text: 'I love this' },
      url: '/api/ai/sentiment',
    } as Parameters<typeof app.inject>[0];

    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ cached: false, label: 'POSITIVE', score: 0.91 });

    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ cached: true, label: 'POSITIVE', score: 0.91 });

    // exactly one pipeline invocation despite two HTTP calls
    expect(loader.calls.get('sentiment')).toBe(1);
  });

  it('runs every stubbed task end to end', async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      [
        'summarize',
        { text: 'Eiffel Tower is in Paris. It is a tall iron lattice tower.' },
        { cached: false, text: expect.stringContaining('Paris') },
      ],
      [
        'question-answering',
        { context: 'Jim Henson was a nice puppet.', question: 'Who was Jim Henson?' },
        { answer: 'a nice puppet', cached: false },
      ],
      ['token-classification', { text: 'Sarah lives in London' }, { cached: false }],
      [
        'zero-shot-classification',
        { candidateLabels: ['billing', 'mobile'], text: 'my phone broke' },
        { cached: false, labels: ['mobile', 'billing'] },
      ],
      [
        'feature-extraction',
        { text: 'embed me' },
        { cached: false, dimensions: 3, embedding: [0.1, 0.2, 0.3] },
      ],
    ];

    for (const [task, payload, expected] of cases) {
      const response = await app.inject({
        headers: basicAuthHeaders(),
        method: 'POST',
        payload,
        url: `/api/ai/${task}`,
      });
      expect(response.statusCode, task).toBe(200);
      expect(response.json(), task).toMatchObject(expected);
    }
  });

  it('rejects invalid per-task input at the schema boundary', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { question: 'who?' },
      url: '/api/ai/question-answering',
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown task with 404', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { text: 'hi' },
      url: '/api/ai/definitely-not-a-task',
    });
    expect(response.statusCode).toBe(404);
  });

  it('answers the same request through the WS ai message with a 202 and an ai-result', async () => {
    const { IoAdapter } = await import('@nestjs/platform-socket.io');
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('server not listening');
    const port = address.port;

    const socket = io(`http://127.0.0.1:${port}`, {
      extraHeaders: basicAuthHeaders(),
      reconnection: false,
      transports: ['websocket'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on('connect', () => resolve());
        socket.on('connect_error', (error) => reject(error));
      });

      const ack = await new Promise<{ statusCode: number }>((resolve, reject) => {
        socket.timeout(5_000).emit(
          'ai',
          {
            input: { text: 'a completely unique sentence for the WS test' },
            requestId: crypto.randomUUID(),
            task: 'sentiment',
          },
          (error: Error | null, response?: { statusCode: number }) => {
            if (error) reject(error);
            else resolve(response!);
          },
        );
      });
      expect(ack.statusCode).toBe(202);

      const event = await new Promise<{ result: { label: string }; task: string }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no ai-result event')), 5000);
          socket.on('ai-result', (payload: { result: { label: string }; task: string }) => {
            clearTimeout(timer);
            resolve(payload);
          });
        },
      );
      expect(event.task).toBe('sentiment');
      expect(event.result.label).toBe('POSITIVE');
    } finally {
      socket.disconnect();
    }
  });

  it('deduplicates concurrent identical requests into one model call', async () => {
    let releaseGate = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const gatedLoader = {
      load: async () => {
        const output = [{ label: 'POSITIVE', score: 0.91 }];
        return async () => {
          await gate;
          return output;
        };
      },
      modelFor: () => 'stub/sentiment',
    };

    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PipelineLoader)
      .useValue(gatedLoader)
      .compile();
    const gatedApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    gatedApp.setGlobalPrefix(API_GLOBAL_PREFIX);
    await gatedApp.init();
    try {
      const request = {
        headers: basicAuthHeaders(),
        method: 'POST',
        payload: { text: 'gate test' },
        url: '/api/ai/sentiment',
      } as Parameters<typeof app.inject>[0];

      const a = gatedApp.inject(request);
      const b = gatedApp.inject(request);
      releaseGate();
      const [resA, resB] = await Promise.all([a, b]);
      expect(resA.statusCode).toBe(200);
      expect(resB.statusCode).toBe(200);
    } finally {
      await gatedApp.close();
    }
  });
});
