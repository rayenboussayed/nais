# Changelog

All notable changes to trainslator are documented here. The project has no
tagged releases yet. Dates are UTC, taken from the commit history.

## Unreleased - 2026-11-18 .. 2026-11-19

### Added

- npm workspaces monorepo: `apps/api` (service), `apps/web` (React console),
  `packages/shared` (zod contracts); toolchain, husky, commitlint, CI (`d4a34ba`,
  `2e246c9`).
- Shared zod v4 contracts for REST and WebSocket surfaces (`z.infer` DTOs,
  list envelopes, cursor helpers); consumed by `@nestjs/swagger` natively via
  Standard Schema (`packages/shared`, `3be6897`, `60742d0`, `67fbc8d`, `d107f3b`).
- NestJS 12 + Fastify API: env validation (fail-fast in production), health
  endpoint, global exception filter with constant error bodies, boot plumbing
  (`c7c2d5c`).
- Data layer: Drizzle ORM, migrations, PostgreSQL; language catalogue seed
  (184 rows, idempotent upsert) (`2185f61`, `67fbc8d`).
- Languages REST module (list/create/findOne/update/soft-delete, keyset
  pagination) (`67fbc8d`).
- Translations REST module (catalogue + admin CRUD, LIKE-escaped search,
  keyset `(created_at, id)` pagination) (`60742d0`).
- AI messages REST module: read-only audit surface of model calls
  (`eebe3ac`).
- Translation pipeline: cache-aside catalogue lookup by sha512 over
  NFC-normalized text, inflight dedup, unified `ai_messages` audit, pg-boss
  queue; WebSocket `translate` message with the ack contract (200 inline
  cached / 202 queued / 400 / 404 / 429 / 500) and `translation` events;
  `POST /api/translate` (`d4dd3bc`, `d107f3b`, `cb72d38`).
- Auth boundary: constant-401 login (scrypt, async), HMAC-signed session
  cookie (HttpOnly, SameSite=Lax, 12h), Basic auth for HTTP and the WS
  handshake, single credential; global login throttler; Swagger UI and the
  docs JSON served behind the same auth (`cb72d38`).
- Adversarial-review hardening: identity-keyed WS rate limiter, origin backstop
  against CSWSH, async scrypt off the event loop, microsecond keyset cursor
  straight from the database, turnover of legacy `environment`/global
  `socket`/raw tsquery bugs (`c38ae1d`).
- React 19 + Vite web app: Playground (`/`), admin console for languages and
  translations (`/admin/*`), session cookie login (`/login`) (`b16b900`).
- Process-level e2e smoke suite (real child process against a throwaway
  cluster) and a CI e2e job (`27a7a5f`).
- General-purpose AI service: per-task dedicated ONNX pipelines via
  transformers.js (`sentiment`, `summarize`, `question-answering`,
  `token-classification` NER, `zero-shot-classification`,
  `feature-extraction`) behind `POST /api/ai/<task>` and `GET /api/ai/tasks`;
  results cached in `ai_cache`, every call audited in `ai_messages`; WS `ai`
  message with the same ack contract; Ollama remains the provider for
  `translate` (`225cff9`).
- Model warmup: `npm run transformers:warmup -w @trainslator/api` prefetches
  the dedicated pipelines into the shared `hf-cache` volume; a
  `transformers-init` one-shot container warms it in Docker (`727acfa`,
  `1fca57a`).
- Docker production and development stacks: PostgreSQL, multi-stage API
  image (non-root, healthcheck), `ollama-init` and `transformers-init`
  one-shots (`4a0b0aa`, `1fca57a`).
- React AI Studio at `/studio`: task picker, per-task forms, live results
  with cache badges (`727acfa`, `64f383f`).
- Performance baseline and microbenchmarks (`npm run test:perf`) (`5fbb9da`).
- Repo docs: README, AGENTS.md (workspace-specific), perf notes
  (`13258ab`, `ce2ba22`, `cd105ea`, `3ec2125`).

### Changed

- `packages/shared` stays CommonJS (dual-consumer CJS/ESM interop); `apps/api`
  is now native ESM (`type: module`, NodeNext, `.js` import extensions)
  (`89dc11e`).
- Per-model semaphore gates concurrent model calls (`AI_MAX_CONCURRENCY`,
  default 2); pipeline loads cool down for 30s after a failure; losing-worker
  audit rows are aligned with the cache winner; cache keys are NFC-normalized;
  BigInt tensor reads coerced (`91d7047`, `225cff9`).
- Strict flat-config ESLint stack adopted repo-wide; zero errors and zero
  warnings; JSDoc coverage completed on every exported symbol (`3ec2125`).
- Keyset pagination centralized in a shared `keysetPage` helper; list
  services unified (`01ca464`).
- Admin components extracted (`AdminSearch`, `Pagination`, `Modal`)
  (`64f383f`).
- Prettier wrapping and knip hygiene (`5be2550`, `0e5d157`).

### Fixed

- AI cache race: the losing worker's audit row is completed with the cache
  winner's text; `ai_cache` rows are immutable with a plain unique
  `(task, model, key)` index; redundant partial index dropped from the
  `low_nightmare` migration (it could never have applied anywhere) (`91d7047`).
- Model load retry storms bounded by a 30s cooldown; boot-time validation of
  configured `AI_<TASK>_MODEL` ids (`91d7047`).
- `.test.tsx` component tests silently excluded from the test glob — they now
  run (437 → 444 tests) (`225cff9`).
- Security: WS handshake rejects unsigned headers; full-text search escaping;
  prompt logging suppressed at info level; model/column identifiers never
  taken from the wire as DB identifiers (`c38ae1d`).

### Notes

- No tagged releases. The Docker image build and the compose flow are not
  verified in every environment; see `README.md` and run `docker compose up
-d --build` on a Docker machine.
