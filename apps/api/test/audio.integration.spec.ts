import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { configureApp } from '../src/bootstrap.js';
import { SttService } from '../src/resources/audio/stt.service.js';
import { type SttResponse } from '../src/schemas/audio.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

const STT_URL = '/api/audio/stt';
const TRANSLATE_URL = '/api/translate';
const RESPONSE: SttResponse = {
  device: 'cpu',
  segments: [{ end: 1200, start: 0, text: 'hello world' }],
  text: 'hello world',
};

/** Stub service together with the calls it observed. */
interface SttStub {
  calls: TranscribeCall[];
  transcribe: (audio: Buffer, language?: string) => Promise<SttResponse>;
}

/** Arguments observed by the stubbed transcribe call. */
interface TranscribeCall {
  audio: Buffer;
  language: string | undefined;
}

/**
 * Creates a transcriber stub that records the exact bytes and language it receives.
 * @returns the stub and its call log
 */
function makeSttStub(): SttStub {
  const calls: TranscribeCall[] = [];
  return {
    calls,
    transcribe: async (audio, language) => {
      calls.push({ audio, language });
      return RESPONSE;
    },
  };
}

/**
 * Builds a one-second 16 kHz mono PCM WAV with a standard 44-byte header.
 * @returns the in-memory WAV bytes
 */
function makeWav(): Buffer {
  const samples = 16_000;
  const dataBytes = samples * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(samples, 24);
  wav.writeUInt32LE(dataBytes, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

describe('audio STT (integration, throwaway PostgreSQL, stubbed transcriber)', () => {
  let cluster: TempCluster;
  let stub: SttStub;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_audio_stt_test');
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
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

  beforeEach(async () => {
    stub = makeSttStub();
    const { AppModule } = await import('../src/app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SttService)
      .useValue(stub)
      .compile();
    // Production-shaped boundary: a 256 KiB global ceiling plus configureApp's
    // onRoute hook that raises only /api/audio/stt to 8 MiB.
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 256 * 1024 }),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
  }, 30_000);

  afterEach(async () => {
    await app.close();
  });

  it('transcribes an in-memory WAV and forwards the exact bytes and language', async () => {
    const wav = makeWav();
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { audio: wav.toString('base64'), language: 'auto' },
      url: STT_URL,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RESPONSE);
    expect(stub.calls).toHaveLength(1);
    const call = stub.calls[0];
    if (!call) throw new Error('transcribe was not called');
    expect(call.audio.equals(wav)).toBe(true);
    expect(call.language).toBe('auto');
  }, 15_000);

  it('accepts a valid body larger than 256 KiB on the STT route', async () => {
    const audio = Buffer.alloc(300 * 1024, 7).toString('base64');
    expect(Buffer.byteLength(JSON.stringify({ audio }))).toBeGreaterThan(256 * 1024);
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { audio },
      url: STT_URL,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(RESPONSE);
  }, 15_000);

  it('rejects invalid base64 with 400', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { audio: '$$$not-base64$$$' },
      url: STT_URL,
    });
    expect(response.statusCode).toBe(400);
  }, 15_000);

  it('rejects unauthenticated requests with 401', async () => {
    const wav = makeWav();
    const response = await app.inject({
      method: 'POST',
      payload: { audio: wav.toString('base64') },
      url: STT_URL,
    });
    expect(response.statusCode).toBe(401);
  }, 15_000);

  it('keeps the 256 KiB global limit on every other POST route', async () => {
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'POST',
      payload: { targetLanguage: 'fr', text: 'x'.repeat(300 * 1024) },
      url: TRANSLATE_URL,
    });
    expect(response.statusCode).toBe(413);
  }, 15_000);
});
