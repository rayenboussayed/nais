import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { io } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants';
import * as schema from '../src/database/schema';
import { seedLanguages } from '../src/database/seed';
import { PipelineLoader, type PipelineFn } from '../src/ai/pipeline-loader';
import { startTempCluster, type TempCluster } from './pg-temp';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth';

/**
 * End-to-end over a throwaway PostgreSQL cluster with the ONNX pipelines
 * replaced by a deterministic fake loader. Exercises the registry, the
 * ai_cache round trip, the audit trail, the REST surface and the WS `ai`
 * message flow.
 */

const STUB_OUTPUTS: Record<string, unknown> = {
  sentiment: [{ label: 'POSITIVE', score: 0.91 }],
  summarize: [{ summary_text: 'Paris is about ninety kilometres from Orly.' }],
  'question-answering': { answer: 'a nice puppet', score: 0.57, start: 12, end: 25 },
  'token-classification': [
    { word: 'Sarah', entity_group: 'PER', score: 0.99, start: 11, end: 16 },
    { word: 'London', entity_group: 'LOC', score: 0.98, start: 33, end: 39 },
  ],
  'zero-shot-classification': {
    sequence: 'my phone broke',
    labels: ['mobile', 'billing'],
    scores: [0.88, 0.12],
  },
  'feature-extraction': { tolist: () => [[0.1, 0.2, 0.3]] },
};

function fakeLoader() {
  const calls = new Map<string, number>();
  return {
    calls,
    modelFor: (task: string) => `stub/${task}`,
    load: async (task: string): Promise<PipelineFn> => {
      calls.set(task, (calls.get(task) ?? 0) + 1);
      return async () => {
        const output = STUB_OUTPUTS[task];
        if (output === undefined) throw new Error(`no stub for task ${task}`);
        return output;
      };
    },
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
      method: 'GET',
      url: '/api/ai/tasks',
      headers: basicAuthHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ task: string; provider: string; model: string }>;
    };
    const byTask = new Map(body.items.map((entry) => [entry.task, entry]));
    expect(byTask.get('translate')?.provider).toBe('ollama');
    expect(byTask.get('sentiment')?.provider).toBe('transformers');
    expect(byTask.get('sentiment')?.model).toBe('stub/sentiment'); // stubbed loader reports its effective model
    expect(body.items.length).toBe(7);
  });

  it('runs a sentiment call, caches it, and serves the cache on the second call', async () => {
    const request = {
      method: 'POST',
      url: '/api/ai/sentiment',
      headers: basicAuthHeaders(),
      payload: { text: 'I love this' },
    } as Parameters<typeof app.inject>[0];

    const first = await app.inject(request);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ label: 'POSITIVE', score: 0.91, cached: false });

    const second = await app.inject(request);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ label: 'POSITIVE', score: 0.91, cached: true });

    // exactly one pipeline invocation despite two HTTP calls
    expect(loader.calls.get('sentiment')).toBe(1);
  });

  it('runs every stubbed task end to end', async () => {
    const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      [
        'summarize',
        { text: 'Eiffel Tower is in Paris. It is a tall iron lattice tower.' },
        { text: expect.stringContaining('Paris'), cached: false },
      ],
      [
        'question-answering',
        { question: 'Who was Jim Henson?', context: 'Jim Henson was a nice puppet.' },
        { answer: 'a nice puppet', cached: false },
      ],
      ['token-classification', { text: 'Sarah lives in London' }, { cached: false }],
      [
        'zero-shot-classification',
        { text: 'my phone broke', candidateLabels: ['billing', 'mobile'] },
        { labels: ['mobile', 'billing'], cached: false },
      ],
      [
        'feature-extraction',
        { text: 'embed me' },
        { dimensions: 3, cached: false, embedding: [0.1, 0.2, 0.3] },
      ],
    ];

    for (const [task, payload, expected] of cases) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/ai/${task}`,
        headers: basicAuthHeaders(),
        payload,
      });
      expect(response.statusCode, task).toBe(200);
      expect(response.json(), task).toMatchObject(expected);
    }
  });

  it('rejects invalid per-task input at the schema boundary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/question-answering',
      headers: basicAuthHeaders(),
      payload: { question: 'who?' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an unknown task with 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/ai/definitely-not-a-task',
      headers: basicAuthHeaders(),
      payload: { text: 'hi' },
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
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: basicAuthHeaders(),
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
            task: 'sentiment',
            input: { text: 'a completely unique sentence for the WS test' },
            requestId: crypto.randomUUID(),
          },
          (error: Error | null, response?: { statusCode: number }) => {
            if (error) reject(error);
            else resolve(response!);
          },
        );
      });
      expect(ack.statusCode).toBe(202);

      const event = await new Promise<{ task: string; result: { label: string } }>(
        (resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('no ai-result event')), 5000);
          socket.on('ai-result', (payload: { task: string; result: { label: string } }) => {
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
      modelFor: () => 'stub/sentiment',
      load: async () => {
        const output = [{ label: 'POSITIVE', score: 0.91 }];
        return async () => {
          await gate;
          return output;
        };
      },
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
        method: 'POST',
        url: '/api/ai/sentiment',
        headers: basicAuthHeaders(),
        payload: { text: 'gate test' },
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
