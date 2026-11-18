import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../app.constants';
import { DRIZZLE } from '../database/drizzle.module';
import { startTempCluster } from '../../test/pg-temp';

// NOTE: ConfigModule resolves loadEnv at module-decorator time, i.e. at
// import. AppModule is therefore imported lazily in beforeEach, after the
// throwaway cluster is up and DATABASE_URL points at it.
describe('GET /api/health (integration)', () => {
  let app: NestFastifyApplication;
  const cluster = startTempCluster('trainslator_health_test');
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPgBossUrl = process.env.PG_BOSS_URL;

  beforeAll(() => {
    process.env.DATABASE_URL = cluster.url();
    delete process.env.PG_BOSS_URL;
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalPgBossUrl === undefined) delete process.env.PG_BOSS_URL;
    else process.env.PG_BOSS_URL = originalPgBossUrl;
    cluster.destroy();
  });

  beforeEach(async () => {
    const { AppModule } = await import('../app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: ['error', 'warn'],
    });
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('answers 200 with terminus liveness payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('answers 404 with the ApiError shape for unknown routes', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404 });
    expect(typeof response.json().message).toBe('string');
  });
});

describe('GET /api/health with a dead database', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    const { AppModule } = await import('../app.module.js');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DRIZZLE)
      .useValue({ execute: () => Promise.reject(new Error('boom')) })
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

  it('answers 503 with a constant message and no internals', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('boom');
  });
});
