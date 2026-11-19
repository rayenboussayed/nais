# trainslator

General-purpose AI service: NestJS 12 + Fastify (REST + WebSocket), Drizzle ORM on PostgreSQL, Ollama for LLMs plus dedicated per-task ONNX models (transformers.js), React 19 + Vite for the web app.

The service exposes one endpoint per AI task (`POST /api/ai/<task>`) with a shared cache-aside + audited pipeline, a legacy synchronous `POST /api/translate` (unchanged), an async WebSocket `ai` message flow, admin REST resources for translations, languages and AI messages, and a Swagger-documented API at `/api/docs`. Translation is one task of many.

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

```bash
curl -u admin:password -X POST http://localhost:3000/api/ai/sentiment \
  -H 'content-type: application/json' -d '{"text": "I love this service"}'
# {"label":"POSITIVE","score":0.9998,"cached":false}
```

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

Production stack (PostgreSQL, Ollama with a one-shot model pull, a `transformers-init` one-shot that pre-downloads the dedicated ONNX models into a shared `hf-cache` volume, and the API image). From the repository root:

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

Image: `apps/api/Dockerfile` is a multi-stage `node:24-alpine` build (dev deps pruned), runs as the non-root `node` user, and ships a `HEALTHCHECK` against `/api/health`. Notes:

- First boot is only green after migrations and the seed have run; both bins are idempotent.
- `ollama-init` pulls `OLLAMA_TEXT_MODEL` (default `bonsai-2:2b`) once and exits; downstream `api` waits for it.
- No secrets are baked into the image; they arrive via `--env-file`/`.env` at runtime.
- Docker build and the compose smoke flow cannot be verified in every CI/dev environment; see the project reports before relying on them in automation.

## Authentication

Single credential, declared as `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD_HASH` in `.env` (scrypt format `scrypt$N$r$p$saltHex$hashHex`; generate with `npm run auth:hash -- --password '...'`). Every HTTP route except `/api/health` and `POST /api/auth/login` requires it, over `Authorization: Basic` or the `trainslator_session` cookie. WebSocket clients authenticate the same way in the handshake middleware. Session cookies: HttpOnly, SameSite=Lax, Path=/, 12h max-age, `Secure` in production.

## Testing

```bash
npm test             # unit + integration (throwaway PostgreSQL clusters)
npm run test:cov     # with v8 coverage (95% lines/functions/statements gate)
npm run test:e2e     # process-level smoke (boots dist/main.js against a throwaway cluster)
npm run test:perf    # microbenchmarks (translationKeyFor, pagination, rate limiter…)
npm run test:mem     # heap-delta memory test (--expose-gc)
```

Integration specs create a throwaway PostgreSQL cluster in /tmp (unix sockets, migrations applied, torn down after). Nothing touches a developer or production database. The dedicated ONNX pipelines are never downloaded in tests: the AI suite stubs the pipeline loader and asserts shapes/normalization against the real contracts (integration runs on the throwaway cluster). A real pipeline smoke can be run manually with `npm run transformers:warmup -w @trainslator/api`.

Coverage of `.tsx` route components is excluded from the gate (v8 cannot map rolldown-compiled JSX reliably — upstream vitest#10475); component behavior is asserted by the jsdom suites (`apps/web/src/routes/*.test.tsx`).

## Layout

- [`apps/api`](apps/api) — NestJS 12 API + WebSocket gateway + pg-boss worker (`ai-task` queue) + transformers.js pipeline loader ([README](apps/api/README.md) · [AGENTS](apps/api/AGENTS.md) · [CHANGELOG](apps/api/CHANGELOG.md))
- [`apps/web`](apps/web) — React 19 + Vite playground, AI Studio (`/studio`) and admin console ([README](apps/web/README.md) · [AGENTS](apps/web/AGENTS.md) · [CHANGELOG](apps/web/CHANGELOG.md))
- [`packages/shared`](packages/shared) — zod contracts shared by the API and the web app (AI tasks, WS messages, OpenAPI inputs) ([README](packages/shared/README.md) · [AGENTS](packages/shared/AGENTS.md) · [CHANGELOG](packages/shared/CHANGELOG.md))

Repo-wide history lives in [CHANGELOG.md](CHANGELOG.md); per-workspace guidance in each workspace's `AGENTS.md`.

## Dependencies & security

- `npm audit --omit=dev` is clean (zero vulnerabilities) as of this writing; it runs in the pre-commit hook and in CI.
- Runtime dependency families: NestJS 12 ecosystem (common/core/platform-fastify/websockets/platform-socket.io/config/terminus/throttler/resilience/ai/swagger), drizzle-orm, pg, pg-boss (+ nestjs-pgboss), socket.io, zod. Web: React 19, TanStack Router/Query, socket.io-client, Vite 8 (Rolldown). No class-validator/class-transformer usage; validation is zod-only.
- `npm-audit` findings must be fixed, not suppressed; there is no `overrides` entry for security reasons.
- Dependency updates are grouped by ecosystem in `.github/dependabot.yml` (nest, testing) on a weekly cadence.

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
