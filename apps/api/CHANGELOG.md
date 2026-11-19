# Changelog

All notable changes to `@trainslator/api` are documented here. No tagged
releases yet. Dates are UTC, from the commit history (2026-11-18 .. 2026-11-19).

## Unreleased

### Added

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

### Changed

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
