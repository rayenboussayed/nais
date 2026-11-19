import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants.js';
import { seedLanguages } from '../src/database/seed.js';
import { TranslationsService } from '../src/translations/translations.service.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';
import { startOllamaStub, type OllamaStub } from './ollama-stub.js';

describe('ws gateway with a failing backend', () => {
  let cluster: TempCluster;
  let stub: OllamaStub;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalOllamaUrl = process.env.OLLAMA_BASE_URL;
  const originalAuthUsername = process.env.BASIC_AUTH_USERNAME;
  const originalAuthHash = process.env.BASIC_AUTH_PASSWORD_HASH;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_ws_failure_test');
    stub = await startOllamaStub({ completion: 'bonjour' });
    process.env.DATABASE_URL = cluster.url();
    process.env.OLLAMA_BASE_URL = stub.url;
    process.env.BASIC_AUTH_USERNAME = 'admin';
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    process.env.BASIC_AUTH_PASSWORD_HASH = `scrypt$16384$8$1$${salt.toString('hex')}$${scryptSync('admin-password', salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
    process.env.SESSION_SECRET = 'a'.repeat(64);
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

  let app: NestFastifyApplication;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    const { AppModule } = await import('../src/app.module.js');
    // The failure under test is in the cache lookup; the gateway must answer a
    // structured 500 ack rather than leave the client hanging.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(TranslationsService)
      .useValue({ findByLanguageAndKey: () => Promise.reject(new Error('db down')) })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.useWebSocketAdapter(new (await import('@nestjs/platform-socket.io')).IoAdapter(app));
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
    await app.listen(0, '127.0.0.1');
  });

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await app.close();
  });

  it('answers a structured 500 ack and handles a non-Error backend failure', async () => {
    const { AppModule } = await import('../src/app.module.js');
    const { LanguagesService } = await import('../src/languages/languages.service.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LanguagesService)
      .useValue({ findByIso: () => Promise.reject('a string, not an error') })
      .compile();
    const otherApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    otherApp.useWebSocketAdapter(
      new (await import('@nestjs/platform-socket.io')).IoAdapter(otherApp),
    );
    otherApp.setGlobalPrefix(API_GLOBAL_PREFIX);
    await otherApp.init();
    await otherApp.listen(0, '127.0.0.1');

    const address = otherApp.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('server not listening');
    const socket = io(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        authorization: `Basic ${Buffer.from('admin:admin-password').toString('base64')}`,
      },
    });
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (error) => reject(error));
    });

    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      socket
        .timeout(5_000)
        .emit(
          'translate',
          { text: 'hello', targetLanguage: 'fr', requestId: crypto.randomUUID() },
          (error: Error | null, ack?: { statusCode: number }) => {
            if (error) reject(error);
            else resolve(ack!);
          },
        );
    });
    expect(response.statusCode).toBe(500);

    socket.disconnect();
    await otherApp.close();
  }, 20_000);

  it('answers a structured 500 ack instead of hanging', async () => {
    const address = app.getHttpServer().address();
    if (!address || typeof address === 'string') throw new Error('server not listening');
    const socket = io(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: {
        authorization: `Basic ${Buffer.from('admin:admin-password').toString('base64')}`,
      },
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (error) => reject(error));
    });

    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      socket
        .timeout(5_000)
        .emit(
          'translate',
          { text: 'hello', targetLanguage: 'fr', requestId: crypto.randomUUID() },
          (error: Error | null, ack?: { statusCode: number }) => {
            if (error) reject(error);
            else resolve(ack!);
          },
        );
    });
    expect(response.statusCode).toBe(500);
  });
});
