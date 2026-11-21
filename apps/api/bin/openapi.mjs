// Emits the committed OpenAPI golden fixture (HTTP, from controller metadata)
// and the WebSocket envelope document (from the API's own Zod schemas).
// Requires `npm run build -w @trainslator/api` to have produced apps/api/dist.
import { scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 * Finds the start of the line that declares `name` at top level.
 * @param {string} source - full text of one schema module
 * @param {string} name - declaration identifier
 * @returns {number} index of the declaration's line start
 * @throws {Error} when no such declaration exists
 */
function declarationLineStart(source, name) {
  let pos = 0;
  while (pos <= source.length) {
    const newline = source.indexOf('\n', pos);
    const line = newline < 0 ? source.slice(pos) : source.slice(pos, newline);
    const body = line.trimStart();
    const head = body.startsWith('export ') ? body.slice('export '.length).trimStart() : body;
    if (head.startsWith(`const ${name} =`) || head.startsWith(`type ${name} =`)) return pos;
    if (newline < 0) break;
    pos = newline + 1;
  }
  throw new Error(`contracts: missing declaration ${name}`);
}

/**
 * Reads the declared identifier from an emitted chunk.
 * @param {string} text - one extracted declaration
 * @returns {string} the identifier it declares
 * @throws {Error} when the chunk contains no declaration
 */
function declaredName(text) {
  for (const line of text.split('\n')) {
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
  throw new Error('contracts: emitted chunk has no declaration');
}

/**
 * Extracts one Zod declaration together with its immediately preceding JSDoc
 * block. The name is located at line start first, so an earlier JSDoc can never
 * expand across intervening declarations; a balanced-delimiter scan keeps
 * multi-line `.refine` callbacks whole.
 * @param {string} source - full text of one schema module
 * @param {string} name - declaration identifier to extract
 * @returns {string} the declaration text, ending at its semicolon
 * @throws {Error} when the declaration is missing or its delimiters never balance
 */
function extractDeclaration(source, name) {
  const declarationStart = declarationLineStart(source, name);
  const start = jsdocStart(source, declarationStart);
  let i = source.indexOf('=', declarationStart);
  if (i < 0) throw new Error(`contracts: no assignment for ${name}`);

  let depth = 0;
  let end = -1;
  while (i < source.length) {
    const afterTrivia = skipTrivia(source, i);
    if (afterTrivia !== i) {
      i = afterTrivia;
      continue;
    }
    const char = source.at(i);
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ';' && depth === 0) {
      end = i + 1;
      break;
    }
    i += 1;
  }
  if (end < 0) throw new Error(`contracts: unbalanced declaration ${name}`);

  return source.slice(start, end);
}

/**
 * Returns the start of the JSDoc block immediately above a declaration, or the
 * declaration itself when the preceding line is not a comment terminator.
 * @param {string} source - full source text
 * @param {number} declarationStart - start of the declaration's line
 * @returns {number} index where the extracted chunk begins
 */
function jsdocStart(source, declarationStart) {
  const newline = declarationStart - 1;
  if (newline < 0 || source.at(newline) !== '\n') return declarationStart;
  const previousStart = source.lastIndexOf('\n', newline - 1) + 1;
  const previous = source.slice(previousStart, newline);
  if (!previous.trimEnd().endsWith('*/')) return declarationStart;

  let cursor = previousStart;
  for (;;) {
    const lineEnd = source.indexOf('\n', cursor);
    const line = lineEnd < 0 ? source.slice(cursor) : source.slice(cursor, lineEnd);
    const trimmed = line.trimStart();
    if (trimmed.startsWith('/**')) return cursor;
    if (!trimmed.startsWith('*')) return declarationStart;
    if (cursor === 0) return declarationStart;
    // cursor is a line start, so cursor - 1 is the newline before this line.
    // Search from cursor - 2 to actually move to the previous line.
    cursor = source.lastIndexOf('\n', cursor - 2) + 1;
  }
}

/**
 * Returns the last non-whitespace character before `at`.
 * @param {string} source - source text
 * @param {number} at - index to walk back from
 * @returns {string|undefined} the preceding significant character, if any
 */
function previousSignificantChar(source, at) {
  let i = at - 1;
  while (i >= 0 && /\s/.test(source.at(i) ?? '')) i -= 1;
  return i < 0 ? undefined : source.at(i);
}

/**
 * Skips a comment that starts at `at`.
 * @param {string} source - source text
 * @param {number} at - index of the slash that opens the comment
 * @param {string} next - the character immediately after that slash
 * @returns {number} index just past the comment, or `at` when it is not one
 */
function skipComment(source, at, next) {
  if (next === '/') {
    let i = at + 2;
    while (i < source.length && source.at(i) !== '\n') i += 1;
    return i;
  }
  if (next === '*') {
    let i = at + 2;
    while (i < source.length && (source.at(i) !== '*' || source.at(i + 1) !== '/')) i += 1;
    return Math.min(i + 2, source.length);
  }
  return at;
}

/**
 * Skips a regex literal so brackets inside it cannot change delimiter depth.
 * @param {string} source - source text
 * @param {number} at - index of the slash that opens the literal
 * @returns {number} index just past the closing slash
 */
function skipRegex(source, at) {
  let inClass = false;
  let i = at + 1;
  while (i < source.length) {
    const char = source.at(i);
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) return i + 1;
    else if (char === '\n') return at + 1;
    i += 1;
  }
  return i;
}

/**
 * Skips a quoted string that starts at `at`.
 * @param {string} source - source text
 * @param {number} at - index of the opening quote
 * @param {string} quote - the quote character
 * @returns {number} index just past the string
 */
function skipString(source, at, quote) {
  let i = at + 1;
  while (i < source.length) {
    if (source.at(i) === '\\') {
      i += 2;
      continue;
    }
    if (source.at(i) === quote) return i + 1;
    i += 1;
  }
  return i;
}

/**
 * Skips a string, comment or regex literal that starts at `at`.
 * @param {string} source - source text
 * @param {number} at - index of the token's first character
 * @returns {number} index just past the token, or `at` when there is none
 */
function skipTrivia(source, at) {
  const char = source.at(at);
  if (char === '/') {
    const next = source.at(at + 1);
    if (next === '/' || next === '*') return skipComment(source, at, next);
    // A slash is a regex opener only where an expression may start; otherwise it
    // is division and its brackets are ordinary operator characters.
    const prev = previousSignificantChar(source, at);
    if (prev === undefined || '!&(+,:;=?[{|~'.includes(prev)) return skipRegex(source, at);
    return at;
  }
  if (char === "'" || char === '"' || char === '`') return skipString(source, at, char);
  return at;
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
const contracts = CONTRACT_SOURCES.flatMap(([path, names]) => {
  const source = readSchemaSource(path);
  return names.map((name) => stripImports(extractDeclaration(source, name)));
});
const emittedNames = contracts.map((chunk) => declaredName(chunk));
if (
  emittedNames.length !== requestedNames.length ||
  requestedNames.some((name, index) => emittedNames.at(index) !== name) ||
  new Set(emittedNames).size !== emittedNames.length
) {
  throw new Error(`contracts: emitted ${emittedNames.join(', ')} != ${requestedNames.join(', ')}`);
}

writeFileSync('generated/contracts.ts', `import { z } from 'zod';\n\n${contracts.join('\n\n')}\n`);
console.log('wrote generated/contracts.ts');
