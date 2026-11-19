# AGENTS.md — notes for agents working in this repo

## Stack

NestJS 12 + Fastify 5 (REST + socket.io WebSocket gateway), Drizzle ORM 1.0 RC
(plain query builder, no relational queries) on PostgreSQL, `@nestjs/ai` with
`@ai-sdk/openai-compatible` against an Ollama `/v1` endpoint (default
`bonsai-2:2b`), pg-boss for the translate queue, React 19 + Vite (Rolldown)
with TanStack Router/Query for the web app. zod v4 contracts in
`packages/shared` are the single source of truth; Swagger consumes them via
native Standard Schema.

## Hard-won lessons (verified in this repo)

1. **DI tokens need value imports.** `ConfigService` and any other provider
   class used as an injection token must be imported as a value (`import { X }`),
   never `import type`. Nest fails with a cryptic "dependency at index N" error
   otherwise — this exact failure hit this repo four times.
2. **`@nestjs/config` evaluates `loadEnv` at module-decorator time** (import
   time). Specs that need `process.env` set must set it before importing app
   modules; import the app lazily inside `beforeAll`/`beforeEach` (the pattern
   in `apps/api/test/*.integration.spec.ts`).
3. **pg-boss connects eagerly at module init** (`boss.start()` in
   `PgBossModule.forRootAsync` with its own retry wrapper). Anything booting a
   full AppModule against a dead database hangs or dies silently; health and
   watcher suites are deliberately scoped to minimal modules.
4. **A partial unique index is load-bearing for the translation cache:**
   `translations_language_key_unique … WHERE deleted_at IS NULL`
   (migration `brave_karen_page`). Without the partial predicate, a soft delete
   poisons the `(language_id, key)` slot forever.
5. **Microsecond precision:** JS `Date` truncates timestamptz to milliseconds;
   the keyset cursor must come from the DB
   (`replace(created_at::text, ' ', 'T')` cast) or anchor rows leak across pages.
6. **Changing `tsx` → vitest:** `.tsx` files with JSX produce no coverage signal
   in v8 (upstream vitest#10475: `parseAstAsync` defaults to `lang: 'js'`).
   Component behavior is asserted via `@testing-library/react` jsdom tests
   (`apps/web/src/**/*.test.tsx`); do not try to collect coverage from them.
7. **Basic auth vs cookies:** the one `authenticateHeaders` implementation
   serves both HTTP (`Authorization: Basic`) and the HMAC session cookie
   (`trainslator_session`, SameSite=Lax, HttpOnly, `Secure` in production);
   it is used by the WS handshake middleware and by `HttpAuthGuard`. Basic
   wins when both are present; never falls back.
8. **Throttler before auth.** Registered as `APP_GUARD`s in this order:
   `ThrottlerGuard` then `HttpAuthGuard`, so credential floods are 429'd
   before any scrypt work. Swagger UI and the docs-json are served at Fastify
   level, so they require their own hook (`registerHttpGuards`).
9. **Observed on real hardware/network:** GitHub SSH (port 22) is intermittently
   reachable; commits must be made locally and retried.
10. **Tests run against real databases:** integration specs create a throwaway
    PostgreSQL cluster in /tmp (unix sockets), apply `drizzle/` migrations,
    and seed. Never point tests at a developer or shared database.

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
  No `any`; no unsafe casts; no non-null `!` outside tests.
- Conventional Commits; husky pre-commit runs
  `npm audit --omit=dev --audit-level=high && npm run typecheck && npm run lint`.
- `npm run check` = build + typecheck + lint + test + knip + format:check.
  All gates are mandatory for every change.
- Keyset pagination on `(created_at, id)`; ILIKE with LIKE-escaped input; no
  raw SQL string building from wire input.
- One source of truth per type: zod contracts (`packages/shared`), Drizzle
  `$inferSelect` for rows, `z.infer` for DTOs.
- Soft delete via `deleted_at`; reads filter it; admin lists expose `onlyDeleted`.
- Secrets only via `.env` (never committed): see `.env.example`.

## Verdicts of the adversarial reviews (subtasks 5–14)

Reviewers found and this repo fixed: identity-keyed rate limiting (was
socket-keyed), async scrypt off the event loop, in-handler 400 WS ack (was
swallowed by the global filter), a 500 WS ack on backend failure, WS origin
check (CSWSH), global rate limiter after throttler, partial unique index for
the cache, microsecond cursor, `changedFields` prototype-key whitelisting.
Rejected with reasons: `__Host-` cookie prefix (breaks dev over plain HTTP),
stateless session `jti` (requires a revocation store), scheme comparison in
`isOriginAllowed` (host equality is the operative check).
