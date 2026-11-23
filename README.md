# trainslator

General-purpose AI service: NestJS 12 + Fastify (REST + WebSocket), Drizzle ORM on PostgreSQL, Ollama for LLMs plus dedicated per-task ONNX models (transformers.js), React 19 + Vite for the web app.

The service exposes one endpoint per AI task (`POST /api/ai/<task>`) with a shared cache-aside + audited pipeline, a legacy synchronous `POST /api/translate` (unchanged), an async WebSocket `ai` message flow, admin REST resources for translations, languages and AI messages, and a Swagger-documented API at `/api/docs`. Translation is one task of many.

Audio speech to text is served by `POST /api/audio/stt`, backed by node-av WhisperTranscriber. The multilingual Whisper `base` model downloads on first use into a persistent `/models` volume. Requests carry base64 audio in a JSON body with a 5 MiB decoded cap. With `STT_DEVICE=auto` the service uses GPU only when a boot-time check finds a device, then falls back to CPU; `STT_DEVICE=cpu` pins CPU.

## AI tasks

| Task                       | Provider        | Default model                                            | Notes                            |
| -------------------------- | --------------- | -------------------------------------------------------- | -------------------------------- |
| `translate`                | Ollama          | `bonsai-2:2b`                                            | catalogue-cached (184 languages) |
| `sentiment`                | transformers.js | `Xenova/distilbert-base-uncased-finetuned-sst-2-english` | binary ±1                        |
| `summarize`                | transformers.js | `Xenova/distilbart-cnn-6-6`                              | CNN/DM-style                     |
| `question-answering`       | transformers.js | `Xenova/distilbert-base-uncased-distilled-squad`         | extractive (SQuAD)               |
| `token-classification`     | transformers.js | `Xenova/bert-base-NER`                                   | NER (CoNLL-2003)                 |
| `zero-shot-classification` | transformers.js | `Xenova/nli-deberta-v3-xsmall`                           | arbitrary labels                 |
| `feature-extraction`       | transformers.js | `onnx-community/all-MiniLM-L6-v2-ONNX`                   | mean-pooled embeddings           |

Override any model with `AI_<TASK>_MODEL` (dashes → underscores), or point `HF_CACHE_DIR` at a shared cache. `GET /api/ai/tasks` lists the live registry, and every call is cached in `ai_cache` (task+model+input hash) and audited in `ai_messages`. Results are stable across calls; a cache hit answers in milliseconds.

Dedicated pipelines are loaded with an automatic device chain: **WebGPU → CPU** (`webgpu` via [Dawn](https://www.npmjs.com/package/webgpu), GPU when a compatible adapter exists; `cpu` is the onnxruntime-node fallback used when no adapter or driver is available). Pin `AI_DEVICE=webgpu|cpu` to select a single device and disable the fallback. `wasm` is deliberately not offered — onnxruntime-node has no WASM execution provider (the WASM path exists only in the browser bundle of transformers.js). The chain is logged per load (`device=`).

```bash
curl -u admin:password -X POST http://localhost:3000/api/ai/sentiment \
  -H 'content-type: application/json' -d '{"text": "I love this service"}'
# {"label":"POSITIVE","score":0.9998,"cached":false}
```

## Observability (optional)

Telemetry is off unless configured — no collector, no ports, no overhead in the default stack.

- **API** (`apps/api`, [docs](apps/api/README.md#observability)): set `OTEL_TRACE_EXPORTER_URL` (OTLP/HTTP, e.g. `http://localhost:4318/v1/traces`) to enable OpenTelemetry — traces via `@fastify/otel` + socket.io + node auto-instrumentations, started before Nest boots and flushed on shutdown; metrics (host + runtime, via `nestjs-otel`) scraped from Prometheus on `OTEL_METRICS_PORT` (default `8888`, bound to `0.0.0.0`).
- **Web** (`apps/web`, [docs](apps/web/README.md#observability)): set `VITE_OTEL_ENDPOINT` at build time (e.g. `VITE_OTEL_ENDPOINT=http://localhost:4318 npm run build -w @trainslator/web`) to auto-instrument `fetch` in the browser and export spans to `/v1/traces`; unset, no telemetry code is ever loaded.

## Quickstart (local, no Docker)

Prereqs: Node.js >= 24, PostgreSQL >= 16 running locally.

```bash
npm ci
npm run build
cp .env.example .env   # set DATABASE_URL and the auth vars; leave the rest as-is

npm run db:migrate     # apply committed migrations
npm run db:seed        # upsert the 184 seeded ISO 639-1 languages
DATABASE_URL=... node apps/api/dist/main.js
```

Then open http://localhost:3000/api/health. Sessions: `POST /api/auth/login` sets the `trainslator_session` cookie (HttpOnly, SameSite=Lax, Secure in production); the Swagger UI at `/api/docs` and every API route except `/api/health` and `/api/auth/login` requires Basic auth or that cookie.

Two dev servers (API watch + Vite dev server with proxying):

```bash
npm run start:dev -w @trainslator/api     # terminal 1, port 3000
npm run dev -w @trainslator/web           # terminal 2, port 4173
```

The web dev server proxies `/api` and `/socket.io` to the API. The web app has three surfaces: the translation Playground, the AI Studio (`/studio` — one form per task), and the Admin console (translations, languages, the AI message audit log).

## Docker

Production stack (PostgreSQL, Ollama with a one-shot model pull, a `transformers-init` one-shot that pre-downloads the dedicated ONNX models into a shared `hf-cache` volume, a persistent `/models` volume for the lazily downloaded Whisper model, and the API image). From the repository root:

```bash
cp .env.example .env   # edit: POSTGRES_PASSWORD, BASIC_AUTH_PASSWORD_HASH, SESSION_SECRET
docker compose up -d --build
docker compose logs -f api
```

The `transformers-init` one-shot is lazy and idempotent — it only downloads models that are not yet in the `hf-cache` volume, and it runs alongside `ollama-init`. First boot without it still works; the first `POST /api/ai/<task>` pays the download instead (documented in the logs as `loading pipeline task=...`). To warm the cache without compose:

```bash
docker run --rm -v trainslator_hf-cache:/hf-cache \
  -e HF_CACHE_DIR=/hf-cache trainslator/api:latest node apps/api/bin/transformers-warmup.mjs
```

The first `POST /api/audio/stt` downloads the about 142 MB `base` model into `/models`. The image does not include it and `transformers-init` does not warm it.

On first deploy, apply migrations and seed once, then restart:

```bash
docker run --rm --env-file .env trainslator/api:latest node apps/api/bin/db-migrate.mjs
docker run --rm --env-file .env trainslator/api:latest node apps/api/bin/db-seed.mjs
docker compose restart api
```

Open http://localhost:3000/api/health (public) and http://localhost:3000/api/docs (auth required).

Development stack (bind-mounted, API in watch mode, Vite dev server on 4173):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

Useful one-offs:

```bash
docker compose exec db psql -U trainslator -d trainslator   # SQL access
docker compose logs -f ollama-init                          # model pull progress
node scripts/ollama-smoke.mjs                               # verify the model is listed
```

Image: `apps/api/Dockerfile` is a multi-stage `node:24-bookworm-slim` build (dev deps pruned), runs as the non-root `node` user, and ships a `HEALTHCHECK` against `/api/health` (Dawn's glibc-only WebGPU binding cannot load on musl/Alpine, which is why the image is not on Alpine). Notes:

- First boot is only green after migrations and the seed have run; both bins are idempotent.
- `ollama-init` pulls `OLLAMA_TEXT_MODEL` (default `bonsai-2:2b`) once and exits; downstream `api` waits for it.
- No secrets are baked into the image; they arrive via `--env-file`/`.env` at runtime.
- Docker build and the compose smoke flow cannot be verified in every CI/dev environment; see the project reports before relying on them in automation.

## Authentication

Single credential, declared as `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD_HASH` in `.env` (scrypt format `scrypt$N$r$p$saltHex$hashHex`; generate with `npm run auth:hash -- --password '...'`). Every HTTP route except `/api/health` and `POST /api/auth/login` requires it, over `Authorization: Basic` or the `trainslator_session` cookie. WebSocket clients authenticate the same way in the handshake middleware. Session cookies: HttpOnly, SameSite=Lax, Path=/, 12h max-age, `Secure` in production.

## Testing

```bash
npm test             # unit + integration (throwaway PostgreSQL clusters)
npm run test:cov     # Istanbul full-source coverage (100% lines/functions/branches/statements, per file)
npm run test:e2e     # process-level smoke (boots dist/main.js against a throwaway cluster)
npm run test:perf    # microbenchmarks (translationKeyFor, pagination, rate limiter…)
npm run test:mem     # heap-delta memory test (--expose-gc)
```

Integration specs create a throwaway PostgreSQL cluster in /tmp (unix sockets, migrations applied, torn down after). Nothing touches a developer or production database. The dedicated ONNX pipelines are never downloaded in tests: the AI suite stubs the pipeline loader and asserts shapes/normalization against the real contracts (integration runs on the throwaway cluster). A real pipeline smoke can be run manually with `npm run transformers:warmup -w @trainslator/api`.

Coverage is measured with **Istanbul** over every authored source file in both workspaces (`apps/api/src/**/*.ts`, `apps/web/src/**/*.{ts,tsx}`), with 100% global **and** per-file thresholds on lines, functions, branches and statements. Istanbul is required because v8's coverage silently drops uncovered `.tsx` files when Rolldown parses them as JavaScript (upstream vitest#10475) — so `.tsx` route components are now in the denominator, with their behavior asserted by the jsdom suites (`apps/web/src/**/*.test.tsx`). The only exclusions are explicit: test files (`*.spec.ts`, `*.test.ts`, `*.test.tsx`), declaration files (`*.d.ts`), `routeTree.gen.ts` and everything under `generated/`. Those generated artifacts are covered by **drift gates** instead: CI rebuilds and regenerates them (`npm run generate:api`, the TanStack Router plugin, drizzle-kit) and fails on any `git diff`; the committed `openapi.golden.json` is compared byte-for-byte by the OpenAPI spec. Never hand-edit generated files to make a gate pass.

## Layout

- [`apps/api`](apps/api) — NestJS 12 API + WebSocket gateway + pg-boss worker (`ai-task` queue) + transformers.js pipeline loader ([README](apps/api/README.md) · [AGENTS](apps/api/AGENTS.md) · [CHANGELOG](apps/api/CHANGELOG.md))
- [`apps/web`](apps/web) — React 19 + Vite playground, AI Studio (`/studio`) and admin console ([README](apps/web/README.md) · [AGENTS](apps/web/AGENTS.md) · [CHANGELOG](apps/web/CHANGELOG.md))
- [`generated`](generated) — committed HTTP types, WebSocket envelope document, WebSocket types and browser form validators generated from the API's zod contracts by `npm run generate:api` after the API build

Repo-wide history lives in [CHANGELOG.md](CHANGELOG.md); per-workspace guidance in each workspace's `AGENTS.md`.

The admin list services share `buildListConditions` and `orderByColumns` from `apps/api/src/utils/sql.ts`, so soft-delete, cursor and ordering rules stay in one place. The languages admin form is a presentational component in `apps/web/src/routes/admin/languages-form.tsx`; its draft state and submit logic stay in the route.

## Dependencies & security

- `npm audit --omit=dev` is clean (zero vulnerabilities) as of this writing; it runs in the pre-commit hook and in CI.
- node-av 7.1.0 ships MIT-licensed JavaScript and a GPL-3.0-or-later, FDK-AAC native binary and CLI. The image includes that GPL FFmpeg build; `node-av-lgpl` and `node-av-light` do not confirm Whisper support.
- Runtime dependency families: NestJS 12 ecosystem (common/core/platform-fastify/websockets/platform-socket.io/config/terminus/throttler/resilience/ai/swagger), drizzle-orm, pg, pg-boss (+ nestjs-pgboss), socket.io, zod. Web: React 19, TanStack Router/Query, socket.io-client, Vite 8 (Rolldown). No class-validator/class-transformer usage; validation is zod-only.
- `npm-audit` findings must be fixed, not suppressed; there is no `overrides` entry for security reasons.
- Dependency updates are grouped by ecosystem in `.github/dependabot.yml` (nest, testing) on a weekly cadence.

## CI and pull request gate

Four workflows in `.github/workflows` run the integration gates, report the pull request status check and publish releases. The `ci` workflow runs typecheck, lint, format, build, generated artifact drift, coverage, migration checks, knip, audit, e2e, perf and mem. It runs on pushes to main and is callable as a reusable workflow. The `docker build` workflow builds both images, `trainslator/api:latest` from `apps/api/Dockerfile` and `trainslator/api:dev` from `apps/api/Dockerfile.dev`. It runs after a successful push to main and on pull requests. The `pr gate` workflow reports an aggregate status check named `pr-gate` and calls both `ci` and `docker build`. The `release` workflow also calls `ci` and is described under Releases.

Configure branch protection by hand in the GitHub repository settings. A workflow file cannot change those settings, and the `pr-gate` check reports a result without granting merge permission. On main, require a pull request before merging, require the `pr-gate` status check, require branches to be up to date before merging, block force pushes and branch deletions, and do not let anyone bypass these rules. Leave auto-merge and the merge queue off.

Pull requests now report `pr-gate` instead of the old `check` and `e2e` contexts. If main already requires those names, remove them from the ruleset before these workflows land. Keeping them leaves every pull request waiting for checks that no longer run. When the ruleset cannot be edited without a passing pull request, turn protection off, land the workflows, then restore protection with the steps below.

GitHub only lets you require a check after it has reported on a commit in the branch. Let one pull request run against the new workflows, then add `pr-gate` to the required checks. Keep branches up to date, block force pushes and branch deletions, leave auto-merge and the merge queue off, and allow no bypasses. A green `pr-gate` makes the Merge button available, and a person still clicks it.

## Releases

Releases are driven by tags on `main`. Once CI is green on `main`, push a
`vMAJOR.MINOR.PATCH` tag, for example `v0.1.0`. The tagged commit must be an
ancestor of `main`; tags on unrelated commits are rejected.

Pushing a `v*` tag starts the release workflow. It verifies the tag and its
commit, reruns the full CI workflow for the tag, checks out the verified commit
to build both images locally,
and publishes three assets on the GitHub Release:
`trainslator-api-<tag>-latest.tar.gz`, `trainslator-api-<tag>-dev.tar.gz` and
`SHA256SUMS`. No registry is used; the images are attached as `docker save`
archives.

Download the three assets, then verify and load an image:

```bash
sha256sum -c SHA256SUMS
docker load -i trainslator-api-<tag>-latest.tar.gz
```

Replace `<tag>` with the release tag, for example `v0.1.0`. Each archive loads
under a versioned tag, `trainslator/api:v0.1.0` or
`trainslator/api:v0.1.0-dev`, so releases do not overwrite each other locally.
Both images are single-arch `linux/amd64` builds. The node-av native build is GPL-3.0-or-later
and FDK-AAC, so redistributing the image needs a license review.

## Commands

```bash
npm ci
npm run build        # workspaces build (shared first)
npm run typecheck
npm run lint         # zero warnings allowed
npm run test:cov     # coverage report
npm run check        # build + typecheck + lint + test + knip + format:check
```

Database scripts:

```bash
npm run db:generate  # drizzle-kit generate (migrations are committed)
npm run db:migrate   # drizzle-kit migrate
npm run db:seed      # idempotent languages seed
```
