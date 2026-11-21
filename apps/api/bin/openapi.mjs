// Emits the committed OpenAPI golden fixture (HTTP, from controller metadata)
// and the WebSocket envelope document (from the API's own Zod schemas).
// Requires `npm run build -w @trainslator/api` to have produced apps/api/dist.
import { scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import ts from 'typescript';
import { z } from 'zod';

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
 * Zod's public JSON Schema converter.
 * @param {object} schema - Zod schema to convert
 * @param {'input'|'output'} io - direction of conversion
 * @returns {object} the OpenAPI 3.0 schema object
 */
function toOpenApiSchema(schema, io) {
  return z.toJSONSchema(schema, { io, target: OPENAPI_TARGET });
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

// Browser-safe runtime contracts are derived from the API's own Zod sources so
// the web form validators cannot drift from the wire contracts. Only a flat,
// import-free subset is emitted; all other server concerns stay server-side.

/**
 * Reads the declared identifier back from an emitted chunk so the
 * post-condition validates output text rather than the requested names.
 * @param {string} chunk - emitted declaration text
 * @returns {string} the declared identifier
 * @throws {Error} when the chunk has no recognizable declaration
 */
function declaredName(chunk) {
  let text = chunk.trimStart();
  while (text.startsWith('/**')) {
    const end = text.indexOf('*/');
    if (end < 0) throw new Error(`contracts: unterminated JSDoc in chunk: ${chunk.slice(0, 40)}`);
    text = text.slice(end + 2).trimStart();
  }
  const bare = text.startsWith('export ') ? text.slice('export '.length).trimStart() : text;
  let keyword = '';
  if (bare.startsWith('const ')) keyword = 'const';
  else if (bare.startsWith('type ')) keyword = 'type';
  const rest = keyword === '' ? '' : bare.slice(keyword.length + 1);
  const name = /^[a-z_$][\w$]*/i.exec(rest)?.[0];
  if (name === undefined)
    throw new Error(`contracts: chunk has no declaration: ${chunk.slice(0, 40)}`);
  return name;
}

/**
 * Extracts one Zod declaration and its adjacent JSDoc from a parsed source file.
 * The text is a verbatim substring of the original source: it begins at the
 * leading JSDoc (or at the declaration itself) and ends at its semicolon.
 * @param {import('typescript').SourceFile} sourceFile - parsed schema source file
 * @param {string} name - declaration identifier to extract
 * @returns {{name: string, text: string}} the declared name and its verbatim chunk
 * @throws {Error} when the declaration is missing
 */
function extractDeclaration(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.getText(sourceFile) === name) {
      return { name, text: statement.getFullText(sourceFile).trim() };
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(sourceFile) !== name) continue;
      return { name, text: statement.getFullText(sourceFile).trim() };
    }
  }
  throw new Error(`contracts: missing declaration ${name}`);
}

/**
 * Removes import statements from an extracted declaration chunk.
 * @param {string} text - declaration text
 * @returns {string} the same text without any import lines
 */
function stripImports(text) {
  return text
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line))
    .join('\n');
}

// Dependency order: primitives first, then schemas that consume them. Every
// reference in an extracted declaration resolves to an earlier declaration or
// to the single `z` import prepended below.
const CONTRACT_SOURCES = [
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

// Literal-path readers keyed by schema source path.
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
 * Reads one schema source using a literal path so the file-security rule
 * never sees a computed filename.
 * @param {string} path - one of the paths in CONTRACT_SOURCES
 * @returns {string} the source text
 */
function readSchemaSource(path) {
  const read = SCHEMA_READERS.get(path);
  if (read === undefined) throw new Error(`contracts: unknown source ${path}`);
  return read();
}

const requestedNames = CONTRACT_SOURCES.flatMap(([, names]) => names);
const extracted = CONTRACT_SOURCES.flatMap(([path, names]) => {
  const source = readSchemaSource(path);
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  return names.map((name) => extractDeclaration(sourceFile, name));
});
const contracts = extracted.map(({ text }) => stripImports(text));
const emittedNames = contracts.map(declaredName);
if (
  emittedNames.length !== requestedNames.length ||
  requestedNames.some((name, index) => emittedNames.at(index) !== name) ||
  new Set(emittedNames).size !== emittedNames.length
) {
  throw new Error(`contracts: emitted ${emittedNames.join(', ')} != ${requestedNames.join(', ')}`);
}

writeFileSync('generated/contracts.ts', `import { z } from 'zod';\n\n${contracts.join('\n\n')}\n`);
console.log('wrote generated/contracts.ts');
