import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

import { API_GLOBAL_PREFIX } from '../src/constants/app.js';
import { createOpenApiDocument } from '../src/swagger.js';
import { TEST_BASIC_AUTH_ENV } from './auth.js';

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalAuthHash = process.env.BASIC_AUTH_PASSWORD_HASH;
const originalAuthUsername = process.env.BASIC_AUTH_USERNAME;
const originalSessionSecret = process.env.SESSION_SECRET;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalAuthHash === undefined) delete process.env.BASIC_AUTH_PASSWORD_HASH;
  else process.env.BASIC_AUTH_PASSWORD_HASH = originalAuthHash;
  if (originalAuthUsername === undefined) delete process.env.BASIC_AUTH_USERNAME;
  else process.env.BASIC_AUTH_USERNAME = originalAuthUsername;
  if (originalSessionSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = originalSessionSecret;
});

describe('OpenAPI golden document', () => {
  it('is byte-deterministic against the committed fixture without a database', async () => {
    // @nestjs/config validates env at import time: set dummies before AppModule.
    process.env.DATABASE_URL = 'postgresql://trainslator:trainslator@db.invalid:5432/trainslator';
    process.env.NODE_ENV = 'test';
    Object.assign(process.env, TEST_BASIC_AUTH_ENV);

    const { AppModule } = await import('../src/app.module.js');
    const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
      logger: false,
      preview: true,
    });
    try {
      app.setGlobalPrefix(API_GLOBAL_PREFIX);
      const document = createOpenApiDocument(app);
      const goldenText = readFileSync('apps/api/test/fixtures/openapi.golden.json', 'utf8');
      const golden: unknown = JSON.parse(goldenText);
      expect(document).toEqual(golden);
      expect(`${JSON.stringify(document, null, 2)}\n`).toBe(goldenText);
    } finally {
      await app.close();
    }
  });
});
