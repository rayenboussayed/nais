import Fastify from 'fastify';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import { loginResponseSchema } from '../src/schemas/auth.js';
import { translationSchema } from '../src/schemas/translations.js';

// Response serialization and parser throughput for the production config gate.
// Run: npm run test:perf
// Assertions live in setup, outside the timed loops, so they do not distort throughput.

// Timed callbacks write here so the engine cannot eliminate their results.
let consumed: unknown;

// Compile the response schema once. Fastify turns it into a fast-json-stringify
// serializer for the route that carries it; the other route uses JSON.stringify.
const responseSchema = z.toJSONSchema(loginResponseSchema, {
  io: 'output',
  target: 'draft-07',
});

const PLAIN_ROUTE = '/plain';
const SCHEMA_ROUTE = '/schema';
const BULK_PLAIN_ROUTE = '/bulk-plain';
const BULK_SCHEMA_ROUTE = '/bulk-schema';
const LOGIN_PAYLOAD = { username: 'alice' } as const;
const LOGIN_JSON = '{"username":"alice"}';

// A real wire contract: uuids, offset datetimes, an enum and nullable fields.
// z.compile returns a clone with a generated fast path; the original keeps
// Zod's runtime parser.
const TRANSLATION_INPUT: z.input<typeof translationSchema> = {
  createdAt: '2026-01-01T00:00:00.000+00:00',
  deletedAt: null,
  id: '123e4567-e89b-42d3-a456-426655440000',
  key: 'greeting',
  languageId: '123e4567-e89b-42d3-a456-426655440000',
  namespace: 'dynamic',
  parentId: null,
  text: 'Hello, world',
  updatedAt: '2026-01-01T00:00:00.000+00:00',
};
const compiledTranslationSchema = z.compile(translationSchema);

/**
 * Build a Fastify app with two GET routes that return the same login payload.
 * `/plain` has no response schema; `/schema` carries the zod-derived draft-07
 * response schema, so Fastify serializes that route with fast-json-stringify.
 * @returns a Fastify instance with both routes registered
 */
function buildApp() {
  const app = Fastify();
  app.get(PLAIN_ROUTE, () => LOGIN_PAYLOAD);
  app.get(SCHEMA_ROUTE, { schema: { response: { 200: responseSchema } } }, () => LOGIN_PAYLOAD);
  return app;
}

// The bulk comparison uses a real list contract as a controlled A/B. Both
// routes return the same FULL_LIST, including two undeclared internal fields.
// The plain route strips them inside its handler, paying that cost on every
// request; the schema route lets fast-json-stringify drop them. Both bodies
// must therefore be byte-identical.
const TRANSLATION_ITEM_COUNT = 20;
const LIST_RESPONSE_SCHEMA = z.toJSONSchema(z.array(translationSchema), {
  io: 'output',
  target: 'draft-07',
});

/**
 * Copy a row without its two undeclared fields. This is the manual stripping
 * the schema-less bulk route pays inside its handler on every request.
 * @param row - a row returned by withInternalFields
 * @returns the row with only its declared wire fields, in schema order
 */
function stripInternalFields(
  row: ReturnType<typeof withInternalFields>,
): z.output<typeof translationSchema> {
  return {
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
    id: row.id,
    key: row.key,
    languageId: row.languageId,
    namespace: row.namespace,
    parentId: row.parentId,
    text: row.text,
    updatedAt: row.updatedAt,
  };
}

/**
 * Build one deterministic translation row with only the declared wire fields.
 * @param index - zero-based index that keeps ids, keys and text distinct
 * @returns a translation row matching translationSchema
 */
function translationItem(index: number): z.output<typeof translationSchema> {
  return {
    createdAt: '2026-01-01T00:00:00.000+00:00',
    deletedAt: null,
    id: `123e4567-e89b-42d3-a456-42665544${String(index).padStart(4, '0')}`,
    key: `static:greeting-${index}`,
    languageId: '123e4567-e89b-42d3-a456-426655440000',
    namespace: 'dynamic',
    parentId: null,
    text: `Translation ${index} of ${TRANSLATION_ITEM_COUNT}`,
    updatedAt: '2026-01-01T00:00:00.000+00:00',
  };
}

/**
 * Attach two undeclared fields to a translation row. The draft-07 schema drops
 * them from the serialized body; a route without a schema would emit them.
 * @param item - a translation row with only declared fields
 * @param index - zero-based index that keeps the extra values distinct
 * @returns the row plus two undeclared properties
 */
function withInternalFields(item: z.output<typeof translationSchema>, index: number) {
  return {
    ...item,
    internalScore: index / TRANSLATION_ITEM_COUNT,
    rowVersion: index,
  };
}

const DECLARED_LIST: Array<z.output<typeof translationSchema>> = Array.from(
  { length: TRANSLATION_ITEM_COUNT },
  (_value, index) => translationItem(index),
);
const FULL_LIST = DECLARED_LIST.map((item, index) => withInternalFields(item, index));
const BULK_JSON = JSON.stringify(DECLARED_LIST);

/**
 * Build a Fastify app with two bulk routes that emit equivalent list bodies.
 * Both return FULL_LIST. `/bulk-plain` strips the two undeclared fields inside
 * its handler; `/bulk-schema` relies on the zod-derived response schema.
 * @returns a Fastify instance with both bulk routes registered
 */
function buildBulkApp() {
  const app = Fastify();
  app.get(BULK_PLAIN_ROUTE, () => FULL_LIST.map(stripInternalFields));
  app.get(
    BULK_SCHEMA_ROUTE,
    { schema: { response: { 200: LIST_RESPONSE_SCHEMA } } },
    () => FULL_LIST,
  );
  return app;
}

describe('Fastify response serialization', () => {
  test('with and without a zod-derived response schema', async ({ bench }) => {
    const app = buildApp();
    const plain = await app.inject({ method: 'GET', url: PLAIN_ROUTE });
    const schema = await app.inject({ method: 'GET', url: SCHEMA_ROUTE });
    expect(plain.statusCode).toBe(200);
    expect(schema.statusCode).toBe(200);
    expect(plain.body).toBe(LOGIN_JSON);
    expect(plain.body).toBe(schema.body);

    await bench('no response schema', async () => {
      consumed = (await app.inject({ method: 'GET', url: PLAIN_ROUTE })).body;
    }).run();
    expect(consumed).toBe(LOGIN_JSON);

    await bench('draft-07 response schema', async () => {
      consumed = (await app.inject({ method: 'GET', url: SCHEMA_ROUTE })).body;
    }).run();
    expect(consumed).toBe(LOGIN_JSON);

    await app.close();
  });

  test('bulk list with and without a zod-derived response schema', async ({ bench }) => {
    const app = buildBulkApp();
    const plain = await app.inject({ method: 'GET', url: BULK_PLAIN_ROUTE });
    const schema = await app.inject({ method: 'GET', url: BULK_SCHEMA_ROUTE });
    expect(plain.statusCode).toBe(200);
    expect(schema.statusCode).toBe(200);
    expect(plain.body).toBe(BULK_JSON);
    expect(schema.body).toBe(BULK_JSON);
    expect(schema.body).toBe(plain.body);
    expect(plain.body).not.toContain('internalScore');
    expect(plain.body).not.toContain('rowVersion');
    expect(schema.body).not.toContain('internalScore');
    expect(schema.body).not.toContain('rowVersion');

    await bench('bulk no response schema', async () => {
      consumed = (await app.inject({ method: 'GET', url: BULK_PLAIN_ROUTE })).body;
    }).run();
    expect(consumed).toBe(BULK_JSON);

    await bench('bulk draft-07 response schema', async () => {
      consumed = (await app.inject({ method: 'GET', url: BULK_SCHEMA_ROUTE })).body;
    }).run();
    expect(consumed).toBe(BULK_JSON);

    await app.close();
  });
});

describe('zod parsing', () => {
  test('runtime parser versus an explicit z.compile copy', async ({ bench }) => {
    const expected = translationSchema.parse(TRANSLATION_INPUT);
    expect(compiledTranslationSchema.safeParse(TRANSLATION_INPUT).success).toBe(true);
    expect(compiledTranslationSchema.parse(TRANSLATION_INPUT)).toEqual(expected);

    await bench('runtime parser', () => {
      consumed = translationSchema.parse(TRANSLATION_INPUT);
    }).run();
    expect(consumed).toEqual(expected);

    await bench('compiled fast path', () => {
      consumed = compiledTranslationSchema.parse(TRANSLATION_INPUT);
    }).run();
    expect(consumed).toEqual(expected);
  });
});
