import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { API_GLOBAL_PREFIX } from '../src/constants/app.js';
import { sttRequestSchema } from '../src/schemas/audio.js';
import { loginRequestSchema } from '../src/schemas/auth.js';
import { createLanguageSchema, updateLanguageBodySchema } from '../src/schemas/languages.js';
import {
  createTranslationSchema,
  translateRequestSchema,
  updateTranslationBodySchema,
} from '../src/schemas/translations.js';
import { createOpenApiDocument } from '../src/swagger.js';
import { TEST_BASIC_AUTH_ENV } from './auth.js';

// Literal-path readers used to compare emitted chunks with API sources.
const SCHEMA_READERS = new Map([
  ['apps/api/src/schemas/ai.ts', () => readFileSync('apps/api/src/schemas/ai.ts').toString()],
  [
    'apps/api/src/schemas/common.ts',
    () => readFileSync('apps/api/src/schemas/common.ts').toString(),
  ],
  ['apps/api/src/schemas/enums.ts', () => readFileSync('apps/api/src/schemas/enums.ts').toString()],
  [
    'apps/api/src/schemas/languages.ts',
    () => readFileSync('apps/api/src/schemas/languages.ts').toString(),
  ],
  [
    'apps/api/src/schemas/translations.ts',
    () => readFileSync('apps/api/src/schemas/translations.ts').toString(),
  ],
]);

/**
 * Reads a schema source through a literal path reader.
 * @param path - one of the declared schema source paths
 * @returns the source text
 */
function readSchemaSource(path: string): string {
  const read = SCHEMA_READERS.get(path);
  if (read === undefined) throw new Error(`unknown schema source ${path}`);
  return read();
}

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalNodeEnv = process.env.NODE_ENV;
const originalAuthHash = process.env.BASIC_AUTH_PASSWORD_HASH;
const originalAuthUsername = process.env.BASIC_AUTH_USERNAME;
const originalSessionSecret = process.env.SESSION_SECRET;

type GeneratedDocument = ReturnType<typeof createOpenApiDocument>;

/**
 * Asserts that one operation documents a JSON response body.
 * @param document - the generated OpenAPI document
 * @param path - the path key of the operation
 * @param method - the HTTP method key of the operation
 * @param status - the response status key
 */
function expectSuccess(
  document: GeneratedDocument,
  path: string,
  method: string,
  status: string,
): void {
  expect(
    responseSchema(document, path, method, status),
    `${method} ${path} ${status}`,
  ).toBeDefined();
}

/**
 * Reads the JSON request body schema of one operation.
 * @param document - the generated OpenAPI document
 * @param path - the path key of the operation
 * @param method - the HTTP method key of the operation
 * @returns the request body schema, or undefined when no JSON body is documented
 */
function requestBodySchema(document: GeneratedDocument, path: string, method: string): unknown {
  const pathItem: unknown = Reflect.get(document.paths, path);
  const operation: unknown = Reflect.get(pathItem ?? {}, method);
  const body: unknown = Reflect.get(operation ?? {}, 'requestBody');
  const content: unknown = Reflect.get(body ?? {}, 'content');
  const json: unknown = Reflect.get(content ?? {}, 'application/json');
  if (!json || typeof json !== 'object' || !('schema' in json)) return undefined;
  return json.schema;
}

/**
 * Reads the JSON response schema of one operation status.
 * @param document - the generated OpenAPI document
 * @param path - the path key of the operation
 * @param method - the HTTP method key of the operation
 * @param status - the response status key
 * @returns the response body schema, or undefined when none is documented
 */
function responseSchema(
  document: GeneratedDocument,
  path: string,
  method: string,
  status: string,
): unknown {
  const pathItem: unknown = Reflect.get(document.paths, path);
  const operation: unknown = Reflect.get(pathItem ?? {}, method);
  const responses: unknown = Reflect.get(operation ?? {}, 'responses');
  const response: unknown = Reflect.get(responses ?? {}, status);
  if (!response || typeof response !== 'object' || !('content' in response)) return undefined;
  const content: unknown = response.content;
  const json: unknown = Reflect.get(content ?? {}, 'application/json');
  if (!json || typeof json !== 'object' || !('schema' in json)) return undefined;
  return json.schema;
}

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

describe('WebSocket OpenAPI document', () => {
  it('lists every WS envelope with ack status codes', () => {
    const document: unknown = JSON.parse(readFileSync('generated/ws.openapi.json', 'utf8'));

    expect(document).toMatchObject({
      components: {
        schemas: {
          WsAiAck: { properties: { statusCode: expect.anything() } },
          WsAiErrorEvent: { type: 'object' },
          WsAiMessage: { type: 'object' },
          WsAiResultEvent: { type: 'object' },
          WsTranslateAck: { properties: { statusCode: expect.anything() } },
          WsTranslateMessage: { type: 'object' },
          WsTranslationErrorEvent: { type: 'object' },
          WsTranslationEvent: { type: 'object' },
        },
      },
      openapi: '3.0.3',
    });
  });
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

      expectSuccess(document, '/api/ai-messages', 'get', '200');
      expectSuccess(document, '/api/ai-messages/{id}', 'get', '200');
      expectSuccess(document, '/api/ai-messages/{id}/prompts', 'get', '200');
      expectSuccess(document, '/api/ai/feature-extraction', 'post', '200');
      expectSuccess(document, '/api/ai/question-answering', 'post', '200');
      expectSuccess(document, '/api/ai/sentiment', 'post', '200');
      expectSuccess(document, '/api/ai/summarize', 'post', '200');
      expectSuccess(document, '/api/ai/tasks', 'get', '200');
      expectSuccess(document, '/api/ai/token-classification', 'post', '200');
      expectSuccess(document, '/api/ai/translate', 'post', '200');
      expectSuccess(document, '/api/ai/zero-shot-classification', 'post', '200');
      expectSuccess(document, '/api/audio/stt', 'post', '200');
      expectSuccess(document, '/api/auth/login', 'post', '200');
      expectSuccess(document, '/api/languages', 'get', '200');
      expectSuccess(document, '/api/languages', 'post', '201');
      expectSuccess(document, '/api/languages/{id}', 'get', '200');
      expectSuccess(document, '/api/languages/{id}', 'patch', '200');
      expectSuccess(document, '/api/translate', 'post', '201');
      expectSuccess(document, '/api/translations', 'get', '200');
      expectSuccess(document, '/api/translations', 'post', '201');
      expectSuccess(document, '/api/translations/{id}', 'get', '200');
      expectSuccess(document, '/api/translations/{id}', 'patch', '200');

      expect(responseSchema(document, '/api/translate', 'post', '201')).toMatchObject({
        properties: { cached: expect.anything(), text: expect.anything() },
        type: 'object',
      });
      expect(responseSchema(document, '/api/auth/login', 'post', '200')).toMatchObject({
        properties: { username: expect.anything() },
        type: 'object',
      });
      expect(responseSchema(document, '/api/ai-messages/{id}/prompts', 'get', '200')).toMatchObject(
        { type: 'array' },
      );
      expect(responseSchema(document, '/api/auth/logout', 'post', '204')).toBeUndefined();

      for (const [path, item] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(item)) {
          if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
          for (const status of ['4XX', '5XX']) {
            expect(
              responseSchema(document, path, method, status),
              `${status} ${method} ${path}`,
            ).toMatchObject({ type: 'object' });
          }
        }
      }
    } finally {
      await app.close();
    }
  });
});

describe('browser-safe generated contracts', () => {
  const declarations: Array<[string, string[]]> = [
    ['apps/api/src/schemas/enums.ts', ['translationNamespaceSchema', 'languageDirSchema']],
    ['apps/api/src/schemas/common.ts', ['iso6391Schema']],
    [
      'apps/api/src/schemas/languages.ts',
      ['createLanguageSchema', 'updateLanguageBaseSchema', 'updateLanguageBodySchema'],
    ],
    [
      'apps/api/src/schemas/translations.ts',
      [
        'MAX_TRANSLATION_TEXT_LENGTH',
        'textSchema',
        'createTranslationSchema',
        'updateTranslationBaseSchema',
        'updateTranslationBodySchema',
      ],
    ],
    ['apps/api/src/schemas/ai.ts', ['AI_TASKS', 'aiTaskSchema', 'aiTaskDescriptorSchema']],
  ];

  it('emits every API declaration verbatim, in order and only once', () => {
    const text = readFileSync('generated/contracts.ts').toString();
    const header = `import { z } from 'zod';\n\n`;
    expect(text.startsWith(header)).toBe(true);
    expect(text.endsWith('\n')).toBe(true);

    const chunks = text.slice(header.length).trimEnd().split('\n\n');
    const expected = declarations.flatMap(([, names]) => names);
    expect(chunks).toHaveLength(expected.length);

    const emitted = chunks.map((chunk) => {
      for (const line of chunk.split('\n')) {
        const body = line.trimStart();
        const head = body.startsWith('export ') ? body.slice('export '.length).trimStart() : body;
        for (const keyword of ['const ', 'type ']) {
          if (head.startsWith(keyword)) {
            const rest = head.slice(keyword.length);
            const end = rest.search(/[\s=]/);
            return end < 0 ? rest : rest.slice(0, end);
          }
        }
      }
      throw new Error('generated contract chunk has no declaration');
    });
    expect(emitted).toEqual(expected);
    expect(new Set(emitted).size).toBe(emitted.length);

    let index = 0;
    for (const [path, names] of declarations) {
      const source = readSchemaSource(path);
      for (const name of names) {
        const chunk = chunks.at(index);
        if (chunk === undefined) throw new Error(`missing chunk for ${name}`);
        expect(source).toContain(chunk);
        expect(chunk).toContain(name);
        index += 1;
      }
    }
    expect(index).toBe(expected.length);
  });
});

describe('Swagger body schemas from zod contracts', () => {
  it('documents a JSON request body for every operation that accepts one', () => {
    const document: GeneratedDocument = JSON.parse(
      readFileSync('apps/api/test/fixtures/openapi.golden.json', 'utf8'),
    );
    let checked = 0;
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
        if (!['patch', 'post'].includes(method)) continue;
        // Logout carries no body; every other mutating route has a zod contract.
        if (path === '/api/auth/logout') continue;
        expect(requestBodySchema(document, path, method), `${method} ${path}`).toBeDefined();
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('matches the JSON Schema derived from each route zod contract', () => {
    const document: GeneratedDocument = JSON.parse(
      readFileSync('apps/api/test/fixtures/openapi.golden.json', 'utf8'),
    );
    const contracts = [
      ['/api/audio/stt', 'post', sttRequestSchema],
      ['/api/auth/login', 'post', loginRequestSchema],
      ['/api/languages', 'post', createLanguageSchema],
      ['/api/languages/{id}', 'patch', updateLanguageBodySchema],
      ['/api/translations', 'post', createTranslationSchema],
      ['/api/translations/{id}', 'patch', updateTranslationBodySchema],
      ['/api/translate', 'post', translateRequestSchema],
    ] as const;

    for (const [path, method, schema] of contracts) {
      const expected = z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0' });
      expect(requestBodySchema(document, path, method), `${method} ${path}`).toEqual(expected);
    }
  });
});
