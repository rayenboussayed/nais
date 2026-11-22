# Changelog

All notable changes to `@trainslator/api` are documented here. No tagged
releases yet. Dates are UTC, from the commit history (2026-11-18 .. 2026-11-19).

## Unreleased

### Added

- Speech to text `POST /api/audio/stt` (`resources/audio/`, `schemas/audio.ts`): node-av 7.1.0 WhisperTranscriber with base64 JSON input (5 MiB decoded cap), multilingual `base` model lazily downloaded into `STT_MODEL_DIR` (`/models`), a boot-time GPU presence heuristic with `STT_DEVICE=auto|gpu|cpu` and CPU retry, bounded by `STT_MAX_CONCURRENCY`. The native binary and CLI are GPL-3.0-or-later and FDK-AAC.
- Boot plumbing: env validation (fail-fast in production), terminus health
  probe, exception filter with constant error bodies, OpenAPI docs behind the
  same auth hook (`c7c2d5c`, `cb72d38`).
- Data layer: Drizzle ORM, migrations, PostgreSQL; 184-row language catalogue
  seed (idempotent upserts, ON CONFLICT) (`2185f61`, `67fbc8d`).
- REST modules: `languages` (CRUD + keyset pagination), `translations`
  (catalogue + admin CRUD), `ai-messages` (read-only audit of model calls)
  (`67fbc8d`, `60742d0`, `eebe3ac`).
- Translation pipeline: cache-aside catalogue lookup (sha512 over
  NFC-normalized text), inflight dedup, unified `ai_messages` audit;
  WebSocket `translate` message with ack contract (200 inline / 202 queued /
  400 / 404 / 429 / 500) and the `translation` event; `ai-task` pg-boss queue
  (`batchSize 1`, `retryLimit 0`) (`d4dd3bc`, `d107f3b`).
- Auth boundary: constant-401 login (scrypt, async), HMAC session cookie,
  Basic auth over HTTP and the WS handshake, login throttler (`cb72d38`).
- General AI service: task registry + dedicated ONNX pipelines via
  transformers.js (`sentiment`, `summarize`, `question-answering`,
  `token-classification`, `zero-shot-classification`, `feature-extraction`)
  behind `POST /api/ai/<task>` and `GET /api/ai/tasks`; `ai_cache`-aside
  caching; unified audit; per-model concurrency semaphore (`AI_MAX_CONCURRENCY`);
  30s cooldown on pipeline load failures; per-task `AI_<TASK>_MODEL`
  overrides (`225cff9`).
- `npm run transformers:warmup` to prefetch the pipelines (`727acfa`).
- WebGPU device chain for the dedicated pipelines (`src/ai/device.ts`,
  `src/ai/webgpu-globals.ts`): `webgpu` → `cpu`, with `AI_DEVICE` pin support
  and a lazy, idempotent Dawn install (`navigator.gpu` shim for
  transformers.js). Warmup bin reuses the chain and hard-exits (Dawn holds
  the process open). Boot-time `AI_DEVICE` validation (`webgpu|cpu`).
- Process-level e2e smoke suite; hardening against review findings:
  identity-keyed WS limiter, CSWSH origin backstop, async scrypt, microsecond
  keyset cursor from the database, `changedFields` prototype-key whitelist
  (`27a7a5f`, `c38ae1d`).
- Docker: multi-stage image (Node 24, non-root `node` user, HEALTHCHECK via
  node fetch), production and development compose stacks, `ollama-init` and
  `transformers-init` one-shots, node-owned `hf-cache` volume (`4a0b0aa`,
  `1fca57a`); image base moved from Alpine to `node:24-bookworm-slim` for the
  glibc-only Dawn WebGPU binding.
- OpenTelemetry (opt-in via `OTEL_TRACE_EXPORTER_URL`): `src/app.tracing.ts`
  builds the Node SDK — OTLP/HTTP traces via `BatchSpanProcessor`,
  W3C trace-context/baggage + B3 propagators, `@fastify/otel`, socket.io and
  node auto-instrumentations — started in `main.ts` before NestFactory.create;
  `TelemetryModule` (`modules/telemetry/`) registers `nestjs-otel` host
  metrics (`OpenTelemetryModule.forRoot({ metrics: { hostMetrics: true } })`)
  and flushes the SDK on Nest's `onApplicationShutdown`, before
  `useProcessExit` terminates the process. Prometheus `/metrics` on
  `OTEL_METRICS_PORT` (default `8888`, bound to `0.0.0.0`).
  `OTEL_DIAG_ENABLED=true` (development) enables OTEL diagnostics; no SDK is
  constructed at all when `OTEL_TRACE_EXPORTER_URL` is unset. Verified live:
  boots with and without OTEL, `/metrics` answers 200, SIGTERM flushes spans
  to a collector.

### Changed

- Source tree reorganized to the same layout as the other NestJS codebases in
  the workspace (`iradable/backend`, `file-fly/packages/backend` — `resources/`
  for request-facing modules, `modules/` for cross-cutting providers,
  `guards/`, `db/`, `utils/`, `schemas/`, `constants/`, `configs/`,
  root `environment.ts`): `common/* → utils/`, `common/list-query.ts →
schemas/`, `config/env.ts → environment.ts`, `config/{throttle,fastify}.ts
→ configs/`, `database/* → db/*`, `http/auth.guard.ts and request-guards.ts
→ guards/`, `http/all-exceptions.filter.ts → app.exception-filter.ts`,
  domains (`ai`, `ai-messages`, `languages`, `translate`, `translations`,
  `health`) → `resources/<domain>/`, `ws/translate.gateway.ts →
resources/translate/translate.gateway.ts`, `auth/{authenticate,session,
validator,origin}.ts → modules/auth/` with the controller/module in
  `resources/auth/`, `queue/* → modules/queue/` with `AI_TASK_QUEUE` and
  `API_GLOBAL_PREFIX` moved to `constants/`. No behavior, deps, or API-shape
  changes.

- Native ESM (`"type": "module"`); relative imports carry `.js` extensions;
  `__dirname` replaced by `fileURLToPath(import.meta.url)` (`89dc11e`).
- Keyset pagination centralized in `keysetPage` shared by the list services
  (`01ca464`).
- translate service: strict timeout/failure mapping (502 on model failure,
  504 on timeout), constant WS error payloads, ResilienceModule `ollama`
  preset (timeout, circuit breaker, bounded bulkhead, no retries)
  (`d4dd3bc`, `c38ae1d`).
- Strict flat-config ESLint stack adopted; JSDoc coverage completed; AI
  pipeline load failures cool down 30s; worker revalidates job payloads with
  the shared schema (`3ec2125`, `91d7047`).

### Fixed

- AI cache audit alignment: the losing worker's audit row is completed with
  the cache winner's text; cache keys are NFC-normalized; BigInt tensor reads
  coerced (`91d7047`).
- `low_nightmare` migration repaired (contained an index drop that could
  never apply on a fresh cluster) — it had never been applied anywhere
  (`91d7047`).
- Boot-time validation of configured `AI_<TASK>_MODEL` (`91d7047`).
- Prettier wrapping and knip hygiene (`0e5d157`).
