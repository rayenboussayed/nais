import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { FASTIFY_ROUTE_SCHEMA_METADATA } from '@nestjs/platform-fastify/constants';
import { DECORATORS } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loginResponseSchema } from '../schemas/auth.js';
import { translationSchema } from '../schemas/translations.js';
import { ApiResponseSchema } from './response-schema.js';

// Metadata keys used by @RouteSchema and @ApiResponse on the handler function.
const ROUTE_SCHEMA_KEY = FASTIFY_ROUTE_SCHEMA_METADATA;
const API_RESPONSE_KEY = DECORATORS.API_RESPONSE;

/**
 * Applies the response decorator to a bare handler and returns that handler.
 * @param schema - response contract passed to the decorator
 * @param status - HTTP status code passed to the decorator
 * @returns the decorated handler so its metadata can be inspected
 */
function applyToHandler(schema: z.ZodType, status: number): () => unknown {
  const handler = (): unknown => undefined;
  const descriptor: TypedPropertyDescriptor<typeof handler> = { value: handler };
  ApiResponseSchema(schema, status)({}, 'handler', descriptor);
  return handler;
}

describe('ApiResponseSchema', () => {
  it('applies Swagger and Fastify response metadata from the zod contract', () => {
    const handler = applyToHandler(loginResponseSchema, HttpStatus.OK);

    const routeSchema = Reflect.getMetadata(ROUTE_SCHEMA_KEY, handler) as {
      response: Record<number, unknown>;
    };
    expect(routeSchema.response[HttpStatus.OK]).toMatchObject({
      properties: { username: { type: 'string' } },
      required: ['username'],
      type: 'object',
    });

    const responses = Reflect.getMetadata(API_RESPONSE_KEY, handler) as Record<
      number,
      { standardSchema: unknown }
    >;
    expect(responses[HttpStatus.OK]?.standardSchema).toBe(loginResponseSchema);
  });

  it('serializes through decorator metadata and strips undeclared properties', async () => {
    const handler = applyToHandler(loginResponseSchema, HttpStatus.OK);
    const routeSchema = Reflect.getMetadata(ROUTE_SCHEMA_KEY, handler) as {
      response: Record<number, unknown>;
    };

    const app = Fastify();
    app.post('/login', { schema: routeSchema }, () => ({
      extra: 'leaked',
      username: 'admin',
    }));
    await app.ready();

    const response = await app.inject({ method: 'POST', url: '/login' });
    expect(response.body).toBe('{"username":"admin"}');
    expect(response.json()).not.toHaveProperty('extra');

    await app.close();
  });

  it('serializes a real multi-field contract in schema order and drops extras', async () => {
    const handler = applyToHandler(translationSchema, HttpStatus.OK);
    const routeSchema = Reflect.getMetadata(ROUTE_SCHEMA_KEY, handler) as {
      response: Record<number, unknown>;
    };
    const app = Fastify();
    app.get('/translation', { schema: routeSchema }, () => ({
      createdAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
      id: '123e4567-e89b-42d3-a456-426655440001',
      internalScore: 0.5,
      key: 'greeting',
      languageId: '123e4567-e89b-42d3-a456-426655440000',
      namespace: 'dynamic',
      parentId: null,
      rowVersion: 7,
      text: 'Hello',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }));
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/translation' });
    expect(response.body).toBe(
      JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z',
        deletedAt: null,
        id: '123e4567-e89b-42d3-a456-426655440001',
        key: 'greeting',
        languageId: '123e4567-e89b-42d3-a456-426655440000',
        namespace: 'dynamic',
        parentId: null,
        text: 'Hello',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(response.body).not.toContain('rowVersion');
    expect(response.body).not.toContain('internalScore');

    await app.close();
  });

  it('rejects a contract declaring the unsafe format', () => {
    const schema = z.string().meta({ format: 'unsafe' });
    expect(() => ApiResponseSchema(schema, HttpStatus.OK)).toThrow(
      'Response schema must not use format unsafe',
    );
  });

  it('rejects a remote ref nested inside an array', () => {
    const schema = z.string().meta({ examples: [{ $ref: 'https://example.com/schema.json' }] });
    expect(() => ApiResponseSchema(schema, HttpStatus.OK)).toThrow(
      'Response schema must not use remote refs',
    );
  });

  it('rejects a remote ref nested inside an object', () => {
    const schema = z.object({ value: z.string().meta({ $ref: 'http://example.com/value' }) });
    expect(() => ApiResponseSchema(schema, HttpStatus.OK)).toThrow(
      'Response schema must not use remote refs',
    );
  });

  it('rejects a remote $id', () => {
    const schema = z.string().meta({ $id: 'https://example.com/schema.json' });
    expect(() => ApiResponseSchema(schema, HttpStatus.OK)).toThrow(
      'Response schema must not use remote $id',
    );
  });

  it('allows a local ref, a local id and a null default', () => {
    const schema = z.object({
      value: z.string().meta({ $id: '#local', $ref: '#/definitions/value', default: null }),
    });
    expect(() => ApiResponseSchema(schema, HttpStatus.OK)).not.toThrow();
  });
});

@Controller()
class SerializerProbeController {
  /**
   * Returns the login wire shape used by the byte-identity check.
   * @returns one username payload
   */
  @ApiResponseSchema(loginResponseSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('probe')
  login(): { username: string } {
    return { username: 'admin' };
  }
}

describe('ApiResponseSchema through the Nest Fastify adapter', () => {
  it('serializes a real controller route to the declared wire bytes', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SerializerProbeController],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });

    try {
      await app.init();
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'POST',
        url: '/probe',
      });
      expect(response.statusCode).toBe(HttpStatus.OK);
      expect(response.body).toBe('{"username":"admin"}');
    } finally {
      await app.close();
    }
  });
});
