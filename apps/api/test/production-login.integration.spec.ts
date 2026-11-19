import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/app.constants.js';
import { TEST_BASIC_AUTH_ENV } from './auth.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

describe('production login (integration)', () => {
  let cluster: TempCluster;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    // Production mode at import time: validateEnv fail-fast rules apply.
    process.env.NODE_ENV = 'production';
    cluster = startTempCluster('trainslator_production_login_test');
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    await pool.end();
  }, 60_000);

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
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
  }, 60_000);

  afterEach(async () => {
    await app.close();
  });

  it('issues the session cookie with Secure in production', async () => {
    const response = await app.inject({
      body: JSON.stringify({ password: 'admin-password', username: 'admin' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: '/api/auth/login',
    });
    expect(response.statusCode).toBe(200);

    const header = response.headers['set-cookie'];
    const setCookie = Array.isArray(header) ? header[0] : header;
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
  });
});
