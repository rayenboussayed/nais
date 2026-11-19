import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from '../../test/auth.js';
import { startTempCluster } from '../../test/pg-temp.js';
import { API_GLOBAL_PREFIX } from '../app.constants.js';
import { validateEnv } from '../config/env.js';
import { DRIZZLE } from '../database/drizzle.module.js';
import { HealthModule } from './health.module.js';

// NOTE: ConfigModule resolves loadEnv at module-decorator time, i.e. at
// import. The health module is deliberately scoped to ConfigModule +
// HealthModule: the endpoint has no business with the queue or a pg
// pool, and booting them would couple this test to a live Ollama/pgboss.
describe('GET /api/health (integration)', () => {
  let app: NestFastifyApplication;
  const cluster = startTempCluster('trainslator_health_test');
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    delete process.env.BASIC_AUTH_USERNAME;
    delete process.env.BASIC_AUTH_PASSWORD_HASH;
    delete process.env.SESSION_SECRET;
    cluster.destroy();
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ cache: true, isGlobal: true, validate: validateEnv }),
        HealthModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
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
    const response = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/nope',
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404 });
    expect(typeof response.json().message).toBe('string');
  });
});

describe('GET /api/health with a dead database', () => {
  let app: NestFastifyApplication;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    // Never dialed: DRIZZLE is stubbed below. validateEnv just needs shape.
    process.env.DATABASE_URL = 'postgresql://trainslator:change-me@127.0.0.1:1/trainslator';
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
  });

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ cache: true, isGlobal: true, validate: validateEnv }),
        HealthModule,
      ],
    })
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
