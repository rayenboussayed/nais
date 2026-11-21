// Emits the committed OpenAPI golden fixture (HTTP, from controller metadata)
// and the WebSocket envelope document (from the API's own Zod schemas).
// Requires `npm run build -w @trainslator/api` to have produced apps/api/dist.
import { scryptSync } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

// @nestjs/config validates env at module-decorator time, so set dummies before
// importing AppModule; all five are valid under validateEnv in test mode.
const SALT = 'ab'.repeat(16);
process.env.BASIC_AUTH_PASSWORD_HASH = `scrypt$1024$8$1$${SALT}$${scryptSync(
  'admin-password',
  Buffer.from(SALT, 'hex'),
  64,
  { N: 1024, p: 1, r: 8 },
).toString('hex')}`;
process.env.BASIC_AUTH_USERNAME = 'admin';
process.env.DATABASE_URL = 'postgresql://trainslator:trainslator@db.invalid:5432/trainslator';
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'a'.repeat(64);

const { NestFactory } = await import('@nestjs/core');
const { FastifyAdapter } = await import('@nestjs/platform-fastify');
const { AppModule } = await import('../dist/app.module.js');
const { API_GLOBAL_PREFIX } = await import('../dist/constants/app.js');
const { createOpenApiDocument } = await import('../dist/swagger.js');

// preview: true skips provider instantiation (so no Drizzle pool or pg-boss
// connection opens) while controller metadata stays visible to Swagger.
const app = await NestFactory.create(AppModule, new FastifyAdapter(), {
  logger: false,
  preview: true,
});
app.setGlobalPrefix(API_GLOBAL_PREFIX);
const document = createOpenApiDocument(app);
await app.close();

mkdirSync('apps/api/test/fixtures', { recursive: true });
writeFileSync(
  'apps/api/test/fixtures/openapi.golden.json',
  `${JSON.stringify(document, null, 2)}\n`,
  'utf8',
);
console.log('wrote apps/api/test/fixtures/openapi.golden.json');

// WebSocket frames have no HTTP paths, so emit a minimal OpenAPI 3.0 document
// whose components.schemas are generated from the very Zod contracts the
// gateway validates. No server starts and no database connection opens.

const { wsAiAckSchema, wsAiErrorEventSchema, wsAiMessageSchema, wsAiResultEventSchema } =
  await import('../dist/schemas/ws.js');
const {
  wsTranslateAckSchema,
  wsTranslateMessageSchema,
  wsTranslationErrorEventSchema,
  wsTranslationEventSchema,
} = await import('../dist/schemas/translations.js');

const OPENAPI_TARGET = 'openapi-3.0';

/**
 * Converts one Zod schema into an OpenAPI 3.0 Schema Object via its native
 * Standard Schema `~standard.jsonSchema` converter.
 * @param {object} schema - Zod schema exposing the Standard JSON Schema converter
 * @param {'input'|'output'} io - direction of conversion
 * @returns {object} the OpenAPI 3.0 schema object
 */
function toOpenApiSchema(schema, io) {
  const converter = schema['~standard'].jsonSchema;
  return io === 'input'
    ? converter.input({ target: OPENAPI_TARGET })
    : converter.output({ target: OPENAPI_TARGET });
}

const wsDocument = {
  components: {
    schemas: {
      WsAiAck: toOpenApiSchema(wsAiAckSchema, 'output'),
      WsAiErrorEvent: toOpenApiSchema(wsAiErrorEventSchema, 'output'),
      WsAiMessage: toOpenApiSchema(wsAiMessageSchema, 'input'),
      WsAiResultEvent: toOpenApiSchema(wsAiResultEventSchema, 'output'),
      WsTranslateAck: toOpenApiSchema(wsTranslateAckSchema, 'output'),
      WsTranslateMessage: toOpenApiSchema(wsTranslateMessageSchema, 'input'),
      WsTranslationErrorEvent: toOpenApiSchema(wsTranslationErrorEventSchema, 'output'),
      WsTranslationEvent: toOpenApiSchema(wsTranslationEventSchema, 'output'),
    },
  },
  info: { title: 'trainslator WebSocket', version: '0.1.0' },
  openapi: '3.0.3',
  paths: {},
};

mkdirSync('generated', { recursive: true });
writeFileSync('generated/ws.openapi.json', `${JSON.stringify(wsDocument, null, 2)}\n`, 'utf8');
console.log('wrote generated/ws.openapi.json');
