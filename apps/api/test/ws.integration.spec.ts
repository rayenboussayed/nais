import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants.js';
import { signSession } from '../src/auth/session.js';
import { translationKeyFor } from '../src/common/key.js';
import * as schema from '../src/database/schema.js';
import { seedLanguages } from '../src/database/seed.js';
import { type OllamaStub, startOllamaStub } from './ollama-stub.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

describe('ws gateway (integration, throwaway cluster + stubbed Ollama)', () => {
  let cluster: TempCluster;
  let stub: OllamaStub;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOllamaUrl = process.env.OLLAMA_BASE_URL;
  const originalAuthUsername = process.env.BASIC_AUTH_USERNAME;
  const originalAuthHash = process.env.BASIC_AUTH_PASSWORD_HASH;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_ws_test');
    stub = await startOllamaStub({ completion: 'bonjour le monde' });
    process.env.DATABASE_URL = cluster.url();
    process.env.OLLAMA_BASE_URL = stub.url;
    process.env.BASIC_AUTH_USERNAME = 'admin';
    process.env.SESSION_SECRET = 'a'.repeat(64);

    // pre-compute a matching scrypt hash for the configured password
    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16);
    process.env.BASIC_AUTH_PASSWORD_HASH = `scrypt$16384$8$1$${salt.toString('hex')}$${scryptSync('admin-password', salt, 64, { N: 16384, p: 1, r: 8 }).toString('hex')}`;

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
    if (originalAuthUsername === undefined) delete process.env.BASIC_AUTH_USERNAME;
    else process.env.BASIC_AUTH_USERNAME = originalAuthUsername;
    if (originalAuthHash === undefined) delete process.env.BASIC_AUTH_PASSWORD_HASH;
    else process.env.BASIC_AUTH_PASSWORD_HASH = originalAuthHash;
    delete process.env.SESSION_SECRET;
    delete process.env.PG_BOSS_URL;
    await stub.close();
    cluster.destroy();
  });

  const sockets: Array<Socket> = [];

  let app: NestFastifyApplication;

  beforeEach(async () => {
    stub.setBehavior({ completion: 'bonjour le monde', delayMs: 0, status: 200 });

    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.useWebSocketAdapter(new (await import('@nestjs/platform-socket.io')).IoAdapter(app));
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.disconnect();
    }
    await app.close();
  });

  /**
   * Opens a socket against the test app, resolving on connect.
   * @param headers - extra handshake headers
   * @param origin - 'same' pins the Origin header to the app's own host, a string sets it verbatim
   * @returns the connected socket
   */
  function connect(headers?: Record<string, string>, origin?: 'same' | string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const address = app.getHttpServer().address();
      if (!address || typeof address === 'string') return reject(new Error('server not listening'));
      const port = address.port;
      const merged = { ...headers };
      if (origin === 'same') merged.origin = `http://127.0.0.1:${port}`;
      else if (origin) merged.origin = origin;
      const finalHeaders = Object.keys(merged).length > 0 ? merged : undefined;
      const socket = io(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        ...(finalHeaders ? { extraHeaders: finalHeaders } : {}),
        forceNew: true,
        reconnection: false,
      });
      sockets.push(socket);
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (error) => reject(error));
    });
  }

  /**
   * Builds the Authorization header for the seeded test credential.
   * @param username - the basic-auth username
   * @param password - the basic-auth password
   * @returns the Authorization header map
   */
  function basicAuthHeader(
    username = 'admin',
    password = 'admin-password',
  ): Record<string, string> {
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');
    return {
      authorization: `Basic ${credentials}`,
    };
  }

  /**
   * Waits for one event on the socket, with a timeout.
   * @param socket - the connected socket
   * @param event - the event name to wait for
   * @param timeoutMs - how long to wait before rejecting
   * @returns the event payload
   */
  function onceEvent<T>(socket: Socket, event: string, timeoutMs = 15_000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
      socket.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  it('rejects a cross-origin websocket handshake even with valid credentials', async () => {
    await expect(connect(basicAuthHeader(), 'https://evil.example.com')).rejects.toThrow();
  });

  it('accepts a same-origin websocket handshake', async () => {
    const socket = await connect(basicAuthHeader(), 'same');
    expect(socket.connected).toBe(true);
  });

  it('rejects an unauthenticated connection', async () => {
    await expect(connect({})).rejects.toThrow();
  });

  it('accepts a connection with basic auth and answers an unknown message without crashing', async () => {
    const socket = await connect(basicAuthHeader());
    expect(socket.connected).toBe(true);
  });

  it('answers a structured 400 ack for an invalid translate payload', async () => {
    const socket = await connect(basicAuthHeader());

    const garbage = await new Promise<{ requestId: null | string; statusCode: number }>(
      (resolve, reject) => {
        socket
          .timeout(5_000)
          .emit(
            'translate',
            { text: 42 },
            (error: Error | null, ack?: { requestId: null | string; statusCode: number }) => {
              if (error) reject(error);
              else resolve(ack!);
            },
          );
      },
    );
    expect(garbage.statusCode).toBe(400);
    expect(garbage.requestId).toBeNull();

    const requestId = crypto.randomUUID();
    const badTarget = await new Promise<{ requestId: null | string; statusCode: number }>(
      (resolve, reject) => {
        socket
          .timeout(5_000)
          .emit(
            'translate',
            { requestId, targetLanguage: 'fra', text: 'hi' },
            (error: Error | null, ack?: { requestId: null | string; statusCode: number }) => {
              if (error) reject(error);
              else resolve(ack!);
            },
          );
      },
    );
    expect(badTarget.statusCode).toBe(400);
    expect(badTarget.requestId).toBe(requestId);
  });

  it('answers 400 with a null requestId for a null payload', async () => {
    const socket = await connect(basicAuthHeader());
    const response = await new Promise<{ requestId: null | string; statusCode: number }>(
      (resolve, reject) => {
        socket
          .timeout(5_000)
          .emit(
            'translate',
            null,
            (error: Error | null, ack?: { requestId: null | string; statusCode: number }) => {
              if (error) reject(error);
              else resolve(ack!);
            },
          );
      },
    );
    expect(response.statusCode).toBe(400);
    expect(response.requestId).toBeNull();
  });

  it('answers 404 for an unsupported target language without crashing', async () => {
    const socket = await connect(basicAuthHeader());
    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      socket
        .timeout(5_000)
        .emit(
          'translate',
          { requestId: crypto.randomUUID(), targetLanguage: 'zz', text: 'hello' },
          (error: Error | null, ack?: { statusCode: number }) => {
            if (error) reject(error);
            else resolve(ack!);
          },
        );
    });
    expect(response.statusCode).toBe(404);
  });

  it('accepts a connection with the session cookie', async () => {
    const cookie = `trainslator_session=${signSession('admin', 'a'.repeat(64)).value}`;
    const socket = await connect({ cookie });
    expect(socket.connected).toBe(true);
  });

  it('translates asynchronously: 202 ack, translation event with the same requestId', async () => {
    const socket = await connect(basicAuthHeader());
    const requestId = crypto.randomUUID();

    const ack = await new Promise<{ data: null | string; requestId: string; statusCode: number }>(
      (resolve, reject) => {
        socket
          .timeout(10_000)
          .emit(
            'translate',
            { requestId, targetLanguage: 'fr', text: 'good morning' },
            (
              error: Error | null,
              response?: { data: null | string; requestId: string; statusCode: number },
            ) => {
              if (error) reject(error);
              else resolve(response!);
            },
          );
      },
    );

    expect(ack.statusCode).toBe(202);
    expect(ack.requestId).toBe(requestId);

    const event = await onceEvent<{ requestId: string; text: string }>(socket, 'translation');
    expect(event.requestId).toBe(requestId);
    expect(event.text).toBe('bonjour le monde');
  });

  it('answers a cached translation inline with 200 and does not enqueue', async () => {
    const socket = await connect(basicAuthHeader());
    const key = translationKeyFor('good morning, cached');

    // seed the cache directly through the catalogue
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
      await db.insert(schema.translations).values({
        key,
        languageId,
        namespace: 'dynamic',
        text: 'cached answer',
      });
    } finally {
      await pool.end();
    }

    const hitsBefore = stub.hitCount();
    const requestId = crypto.randomUUID();
    const ack = await new Promise<{ data: null | string; statusCode: number }>(
      (resolve, reject) => {
        socket
          .timeout(5_000)
          .emit(
            'translate',
            { requestId, targetLanguage: 'fr', text: 'good morning, cached' },
            (error: Error | null, response?: { data: null | string; statusCode: number }) => {
              if (error) reject(error);
              else resolve(response!);
            },
          );
      },
    );

    expect(ack.statusCode).toBe(200);
    expect(ack.data).toBe('cached answer');
    expect(stub.hitCount()).toBe(hitsBefore);
  });

  it('answers 429 after the per-connection rate limit is exceeded', async () => {
    // Seed one cached entry so every probe answers inline with 200 (no queue
    // traffic); the limiter counts messages, not cache state.
    const seedText = 'rate limit probe';
    const seedKey = translationKeyFor(seedText);
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
      await db
        .insert(schema.translations)
        .values({ key: seedKey, languageId, namespace: 'dynamic', text: 'probe answer' })
        .onConflictDoNothing();
    } finally {
      await pool.end();
    }

    const socket = await connect(basicAuthHeader());

    let lastAck: undefined | { statusCode: number };
    for (let i = 0; i < 11; i += 1) {
      lastAck = await new Promise<{ statusCode: number }>((resolve, reject) => {
        socket
          .timeout(5_000)
          .emit(
            'translate',
            { requestId: crypto.randomUUID(), targetLanguage: 'fr', text: seedText },
            (error: Error | null, response?: { statusCode: number }) => {
              if (error) reject(error);
              else resolve(response!);
            },
          );
      });
    }

    expect(lastAck?.statusCode).toBe(429);
    expect(lastAck).toHaveProperty('retryAfterMs', 60_000);
  });

  it('runs two identical concurrent requests through one model call', async () => {
    const socket = await connect(basicAuthHeader());
    const hitsBefore = stub.hitCount();
    const text = 'deduplicate me please';

    const events: Array<{ cached: boolean; requestId: string; text: string }> = [];
    socket.on('translation', (event: { cached: boolean; requestId: string; text: string }) => {
      events.push(event);
    });

    const emitOnce = () =>
      new Promise<{ statusCode: number }>((resolve, reject) => {
        socket
          .timeout(10_000)
          .emit(
            'translate',
            { requestId: crypto.randomUUID(), targetLanguage: 'fr', text },
            (error: Error | null, response?: { statusCode: number }) => {
              if (error) reject(error);
              else resolve(response!);
            },
          );
      });

    const [first, second] = await Promise.all([emitOnce(), emitOnce()]);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);

    await vi.waitFor(
      () => {
        if (events.length < 2)
          throw new Error(`waiting for 2 translation events, got ${events.length}`);
      },
      { interval: 50, timeout: 15_000 },
    );

    expect(events).toHaveLength(2);
    expect(events[0]?.text).toBe(events[1]?.text);
    expect(new Set(events.map((event) => event.text))).toEqual(new Set(['bonjour le monde']));
    expect(stub.hitCount() - hitsBefore).toBe(1);
  }, 20_000);
});
