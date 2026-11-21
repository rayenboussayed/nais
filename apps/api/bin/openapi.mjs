// Emits the committed OpenAPI golden fixture from controller metadata alone.
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
