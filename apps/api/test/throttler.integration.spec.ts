import path from 'node:path';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';

describe('HTTP rate limit (integration)', () => {
  let cluster: TempCluster;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalThrottle = process.env.THROTTLE_LIMIT;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '2'; // read at module import time, hence before boot
    cluster = startTempCluster('trainslator_throttler_test');
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    const { seedLanguages } = await import('../src/database/seed.js');
    await seedLanguages(db);
    await pool.end();
  }, 60_000);

  afterAll(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalThrottle === undefined) delete process.env.THROTTLE_LIMIT;
    else process.env.THROTTLE_LIMIT = originalThrottle;
    delete process.env.BASIC_AUTH_USERNAME;
    delete process.env.BASIC_AUTH_PASSWORD_HASH;
    delete process.env.SESSION_SECRET;
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

  it('allows up to the configured limit then answers 429', async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ok = await app.inject({
        method: 'GET',
        url: '/api/languages',
        headers: basicAuthHeaders(),
      });
      expect(ok.statusCode, `attempt ${attempt + 1}`).toBe(200);
    }

    const limited = await app.inject({
      method: 'GET',
      url: '/api/languages',
      headers: basicAuthHeaders(),
    });
    expect(limited.statusCode).toBe(429);
  });
});
