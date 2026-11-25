# AGENTS.md — notes for agents working in this repo

## Stack

NestJS 12 + Fastify 5 (REST + socket.io WebSocket gateway), Drizzle ORM 1.0 RC
(plain query builder, no relational queries) on PostgreSQL, `@nestjs/ai` with
`@ai-sdk/openai-compatible` against an Ollama `/v1` endpoint (default
`bonsai-2:2b`) for LLM work, `@huggingface/transformers` + `onnxruntime-node`
for dedicated per-task ONNX pipelines (sentiment, summarize, QA, NER,
zero-shot, embeddings), pg-boss for the `ai-task` queue (all tasks), React 19 +
Vite (Rolldown) with TanStack Router/Query for the web app. zod v4 contracts live in `apps/api/src/schemas`; Swagger consumes them via
native Standard Schema and generates the types used by the web app.

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
   the keyset cursor must come from the DB. `timestamptzCursor` uses
   `to_char(column, 'YYYY-MM-DD"T"HH24:MI:SS.USOF')` because a `::text` cast
   depends on the session `DateStyle` setting. Anchor rows leak across pages
   without the database formatted value.
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
10. **A global `APP_GUARD` throttler crashes on WS frames.** `@nestjs/throttler`
    runs on WebSocket contexts too and dies on malformed payloads (reading
    `.header` of a null data frame). `skipHealthProbe`
    (apps/api/src/configs/throttle.ts) skips non-http contexts; the WS gateway
    enforces its own identity-keyed limiter. Caught by an integration test that
    emitted `translate` with a literal `null` payload.
11. **New indexes change planner output order.** After adding a composite
    `(created_at, id)` index, a seed that ordered by `created_at` alone returned
    a different row (identical timestamps + index scan). Address rows by a
    unique column (or full tie-break key) in fixtures.
12. **Tests run against real databases:** integration specs create a throwaway
    PostgreSQL cluster in /tmp (unix sockets), apply `drizzle/` migrations,
    and seed. Never point tests at a developer or shared database.

13. **A general-purpose AI gateway splits cleanly along task boundaries.**
    Provider per task: Ollama for LLM work (translate), dedicated ONNX
    pipelines via `@huggingface/transformers` for the dedicated text tasks. Pipelines
    are lazy singletons cached by effective model id; the first request pays
    the model download (verified: all six dedicated pipelines download and run in this repo). Tests stub `PipelineLoader` — the registry, cache round-trip and
    audit trail are covered without network.
14. **Generated types are committed artifacts.** Build the API first, then
    `npm run generate:api` writes `apps/api/test/fixtures/openapi.golden.json`,
    `generated/api.d.ts`, `generated/ws.openapi.json`, `generated/ws.d.ts` and
    `generated/contracts.ts` from the API's own Zod contracts. The last file
    carries the browser form validators, so the web has no second copy of the
    API constraints. CI regenerates everything after the build and fails on
    drift. Never hand-edit generated files.

15. **onnxruntime-node ships native binaries in the package (548 MB).** Its
    postinstall only prunes; this repo's npm install-scripts policy is left
    intact (`npm install-scripts ls` shows it as pending, and the runtime
    works fine — the Docker image installs with `--ignore-scripts` as usual).
16. **WS gateway + pg-boss generalize together.** `translate` message stays
    byte-compatible; the `ai` message carries `{ task, input, requestId }`
    with the same ack contract (200 inline/202/400/404/429/500). The worker
    emits `translation` for translate and `ai-result`/`ai-error` otherwise.
17. **The test harness needs serial boots under CI load.** Each integration
    spec boots a full Nest app + throwaway cluster; parallel workers push
    hooks past timeouts. `fileParallelism: false` in vitest.config.mts keeps
    the suite deterministic everywhere (~80s wall, green CI).
18. **`.test.tsx` files must be in the test include glob.** Route component
    tests existed but never ran (`.test.{ts,tsx}` was missing) — the global
    glob had silently excluded all `.tsx` tests. With them running, jsdom
    behavior tests assert playground/studio/admin rendering.

19. **Lint comes from one shared config.** eslint.config.mjs calls
    `createConfig` from `@stackrb/eslint-config` with `target: node`,
    `nodeVersion` at 24, and `extraIgnores` for generated files. A small
    `off()` helper keeps unicorn, stylistic, Vitest and Playwright presets
    unopinionated as they were before. The shared config reports unused
    disable directives, so stale suppressions must be removed. New
    suppressions stay inline with a reason. Browser globals apply only to
    apps/web, and `tryExtensions` is set for code files. Generated files keep
    the generator's formatting: drizzle snapshots are in .prettierignore. The
    prompt templates are `.txt` because `[Tr.: …]` is model-facing DSL, so
    never HTML-comment-suppress lint inside a prompt file.

20. **Speech to text is a third provider family.** `POST /api/audio/stt` runs
    node-av 7.1.0 WhisperTranscriber, separate from Ollama and the ONNX
    pipelines. Import `node-av/api` lazily inside the transcriber method so
    OpenAPI generation and unit tests never load native code. GPU failure
    surfaces on the first async-generator `next()`, so a CPU retry must reopen
    the Demuxer and Decoder from the retained Buffer. Bound concurrency to the
    libuv pool, check `/dev/dri` or `/dev/nvidia0` before attempting GPU, and
    keep `STT_DEVICE=cpu` as the escape hatch on broken drivers. Scope large
    bodies with the Fastify `onRoute` hook in `configs/body-limit.ts` instead
    of raising the global limit. The native build is GPL-3.0-or-later and
    FDK-AAC; review before distributing the image.

## Per-workspace guidance

`apps/api/AGENTS.md` and `apps/web/AGENTS.md`
refine this document for their workspace; they take precedence for their own
files. This file keeps repo-wide policy only.

## Conventions

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.
  No `any`; no unsafe casts; no non-null `!` outside tests.
- Conventional Commits; husky pre-commit runs
  `npm audit --omit=dev --audit-level=high && npm run typecheck && npm run lint`.
- `npm run check` = build + typecheck + lint + test + knip + format:check.
  All gates are mandatory for every change.
- Keyset pagination on `(created_at, id)`; ILIKE with LIKE-escaped input; no
  raw SQL string building from wire input.
- One source of truth per type: API zod contracts in `apps/api/src/schemas`,
  generated OpenAPI types for the web, Drizzle `$inferSelect` for rows.
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
