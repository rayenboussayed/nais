import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { configureApp } from '../src/bootstrap.js';
import { basicAuthHeaders, TEST_BASIC_AUTH_ENV } from './auth.js';
import { startTempCluster, type TempCluster } from './pg-temp.js';

describe('HTTP boundary (integration, throwaway cluster)', () => {
  let cluster: TempCluster;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_http_boundary_test');
    process.env.DATABASE_URL = cluster.url();
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);
    delete process.env.PG_BOSS_URL;

    const pool = new Pool({ connectionString: cluster.url() });
    const db = drizzle({ client: pool });
    await migrate(db, { migrationsFolder: path.join(__dirname, '..', 'drizzle') });
    const { seedLanguages } = await import('../src/db/seed.js');
    await seedLanguages(db);
    await pool.end();
  }, 60_000);

  afterAll(() => {
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
    await configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests with 401 and a realm header', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/languages' });
    expect(response.statusCode).toBe(401);
    expect(response.headers['www-authenticate']).toContain('Basic realm="trainslator"');
    expect(response.json()).toMatchObject({ message: 'Unauthorized', statusCode: 401 });
  });

  it('serves the login page flow: login sets the cookie, cookie authenticates, logout clears it', async () => {
    const login = await app.inject({
      body: JSON.stringify({ password: 'admin-password', username: 'admin' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: '/api/auth/login',
    });
    expect(login.statusCode).toBe(200);
    const setCookieHeader = login.headers['set-cookie'];
    const setCookie = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
    expect(setCookie).toContain('trainslator_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=');

    const session = /trainslator_session=[^;]+/.exec(setCookie ?? '')?.[0];
    if (!session) throw new Error('missing session cookie');

    const authed = await app.inject({
      headers: { cookie: session },
      method: 'GET',
      url: '/api/languages',
    });
    expect(authed.statusCode).toBe(200);

    const logout = await app.inject({
      headers: { cookie: session },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(logout.statusCode).toBe(204);
    const logoutCookieHeader = logout.headers['set-cookie'];
    const logoutCookie = Array.isArray(logoutCookieHeader)
      ? logoutCookieHeader[0]
      : logoutCookieHeader;
    expect(logoutCookie).toContain('Max-Age=0');
  });

  it('rejects a wrong password with a constant 401 body', async () => {
    const response = await app.inject({
      body: JSON.stringify({ password: 'wrong-password', username: 'admin' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: '/api/auth/login',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Invalid credentials', statusCode: 401 });
  });

  it('rejects a cross-origin mutation even with valid credentials', async () => {
    const response = await app.inject({
      headers: { ...basicAuthHeaders(), origin: 'https://evil.example.com' },
      method: 'POST',
      url: '/api/auth/logout',
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ message: 'Forbidden origin', statusCode: 403 });
  });

  it('accepts a same-origin mutation (goes to handler auth, not 403)', async () => {
    const response = await app.inject({
      headers: { host: 'admin.example.com', origin: 'http://admin.example.com' },
      method: 'POST',
      url: '/api/auth/logout',
    });
    // Same origin passes the origin check and reaches the auth guard: 401, not 403.
    expect(response.statusCode).toBe(401);
  });

  it('limits login attempts to five per minute per client and answers 429', async () => {
    for (let iteration = 1; iteration <= 5; iteration += 1) {
      const wrong = await app.inject({
        body: JSON.stringify({ password: `wrong-${iteration}`, username: 'admin' }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        url: '/api/auth/login',
      });
      expect(wrong.statusCode, `attempt ${iteration}`).toBe(401);
    }

    const blocked = await app.inject({
      body: JSON.stringify({ password: 'admin-password', username: 'admin' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: '/api/auth/login',
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ message: 'Too many login attempts', statusCode: 429 });
  }, 15_000);

  it('rejects a wrong username (not an allowlisted prefix) with the same constant body', async () => {
    const response = await app.inject({
      body: JSON.stringify({ password: 'admin-password', username: 'root' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      url: '/api/auth/login',
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ message: 'Invalid credentials', statusCode: 401 });
  });

  it('rejects unauthenticated docs requests and serves them behind auth', async () => {
    const open = await app.inject({ method: 'GET', url: '/api/docs-json' });
    expect(open.statusCode).toBe(401);

    const spec = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/docs-json',
    });
    expect(spec.statusCode).toBe(200);
    const body = spec.json() as {
      info: { title: string };
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(body.openapi.startsWith('3')).toBe(true);
    expect(body.info.title).toBe('trainslator');
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/translate',
        '/api/languages',
        '/api/ai/tasks',
        '/api/ai/sentiment',
        '/api/ai/summarize',
        '/api/ai/question-answering',
        '/api/ai/token-classification',
        '/api/ai/zero-shot-classification',
        '/api/ai/feature-extraction',
        '/api/ai/translate',
      ]),
    );

    // The general AI routes carry their zod-derived schemas into the document.
    const ai = body.paths['/api/ai/sentiment'] as {
      post: {
        requestBody?: {
          content: {
            'application/json': {
              schema: { properties?: Record<string, unknown>; required?: string[] };
            };
          };
        };
      };
    };
    expect(ai.post.requestBody?.content['application/json'].schema.required).toEqual(['text']);

    const html = await app.inject({
      headers: basicAuthHeaders(),
      method: 'GET',
      url: '/api/docs',
    });
    expect(html.statusCode).toBe(200);
    expect(html.body.toLowerCase()).toContain('swagger');
  });

  it('still answers 200 on /api/health without credentials', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    const withQuery = await app.inject({ method: 'GET', url: '/api/health?probe=1' });
    expect(withQuery.statusCode).toBe(200);
  });
});
