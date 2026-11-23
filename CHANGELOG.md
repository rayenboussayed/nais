# Changelog

All notable changes to trainslator are documented here. The project has no
tagged releases yet. Dates are UTC, taken from the commit history.

## Unreleased - 2026-11-23

### Changed

- Refactor pass across the two apps. One helper in `apps/api/src/utils/error-name.ts` now formats error names for logs, two pure helpers in `apps/api/src/utils/sql.ts` build the shared keyset list conditions and ordering, and `apps/web/src/routes/admin/languages-form.tsx` holds the presentational markup extracted from the languages admin route. Wire contracts, generated artifacts, SQL and log strings are unchanged.
- Added characterization assertions for log fallbacks that had no test, SQL-text assertions for the new query helpers, and direct component tests for the extracted admin form. Coverage stays at 100 percent on all four counters.

## Unreleased - 2026-11-21

### Added

- Speech to text endpoint `POST /api/audio/stt` backed by node-av 7.1.0 WhisperTranscriber: base64 audio in a JSON body with a 5 MiB decoded cap, multilingual `base` Whisper model downloaded lazily into a persistent `/models` volume, a boot-time GPU device heuristic with CPU fallback and a reliable `STT_DEVICE=cpu` pin, and four `STT_*` env vars. The native binary and CLI are GPL-3.0-or-later and FDK-AAC; the JavaScript is MIT. The audio non-goal in `docs/ai-v1.md` was replaced by the new endpoint.

### Changed

- Removed `packages/shared`. Runtime zod contracts now live in `apps/api/src/schemas`, and the web uses HTTP and WebSocket types generated from those contracts by `openapi-typescript` and consumed with `openapi-fetch`.
- Added an official NestJS agent-skills set and switched the git remote to `rayenboussayed/nais`.
- OpenAPI now documents response bodies, UUID path params and shared error envelopes; a committed golden fixture and CI freshness guard keep generated artifacts current.
- Deep refactoring pass: AI result normalization and failed-audit updates moved into pure utilities, the web response paths share one mapper, the translations admin route was split, and language selectors refresh after admin mutations.
- Browser form validators are generated from the API Zod sources, so web validation has one source of truth. The profiler runs benchmark files only, and CI checks migration snapshots for consistency.
- Coverage now uses Istanbul over every authored TS/TSX file in both workspaces with 100% global and per-file thresholds; the previous v8-based 95% gate and `.tsx` exclusion are gone. Only tests, declarations, `routeTree.gen.ts` and `generated/**` are excluded; those artifacts are guarded by CI regeneration + `git diff` drift gates and the committed OpenAPI golden fixture.
- Serializer gate recorded in `docs/perf.md`: the corrected compile import is `import "zod/compile"` because zod 4.6.7 has no `zod/compiler` export and compilation is lazy on first parse. Zod-derived response schemas now ship on every route that previously declared a response contract; the measured Node 24 result clears the gate and the OpenAPI golden document is byte identical. Request bodies stay on the shared zod contracts through `@Body({ schema })` and the Standard Schema converter, so no second JSON Schema copy was added. Fastify 5 already bundles fast-json-stringify, so no direct dependency was added.

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
- WebGPU-accelerated ONNX pipelines: dedicated tasks now load with an
  automatic device chain `webgpu` → `cpu` (Dawn via the `webgpu` package;
  verified live: `device=webgpu` on Mesa lavapipe, output dims `[1,384]`;
  GPU-less machines fall back to `cpu`). `AI_DEVICE` pins a single device.
  The API image moved to `node:24-bookworm-slim` (Dawn's binding is
  glibc-only; Alpine/musl cannot load it). `wasm` is not supported in Node
  (onnxruntime-node has no WASM EP) and is rejected at boot.
- Docker production and development stacks: PostgreSQL, multi-stage API
  image (non-root, healthcheck), `ollama-init` and `transformers-init`
  one-shots (`4a0b0aa`, `1fca57a`).
- React AI Studio at `/studio`: task picker, per-task forms, live results
  with cache badges (`727acfa`, `64f383f`).
- Performance baseline and microbenchmarks (`npm run test:perf`) (`5fbb9da`).
- Repo docs: README, AGENTS.md (workspace-specific), perf notes
  (`13258ab`, `ce2ba22`, `cd105ea`, `3ec2125`).

- Optional OpenTelemetry for both apps (disabled unless configured): apps/api
  `OTEL_TRACE_EXPORTER_URL` enables OTLP/HTTP traces (`@fastify/otel` +
  socket.io + node auto-instrumentations, started before Nest boots, flushed
  on shutdown via a Nest lifecycle hook) and Prometheus `/metrics` on
  `OTEL_METRICS_PORT` (default 8888, bound to 0.0.0.0) with `nestjs-otel`
  host metrics; apps/web build-time `VITE_OTEL_ENDPOINT` auto-instruments
  browser `fetch` with W3C propagation. Verified end to end (spans arrive at
  a collector; `/metrics` answers 200; SIGTERM flushes). No collector ships
  in compose.

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
- `apps/api` source tree reorganized to the shared NestJS layout used by
  `iradable/backend` and `file-fly/packages/backend` (`resources/<domain>/`,
  `modules/<name>/`, `guards/`, `db/`, `utils/`, `schemas/`, `constants/`,
  `configs/`, root `environment.ts`); no behavior changes.

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
