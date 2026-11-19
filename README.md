# trainslator

Standalone AI translation service: NestJS 12 + Fastify (REST + WebSocket), Drizzle ORM on PostgreSQL, Ollama for models, React 19 + Vite for the web app.

The service exposes a synchronous REST `POST /api/translate`, an async WebSocket `translate` message flow (cookie or Basic auth), admin REST resources for translations, languages and AI messages, and a Swagger-documented API at `/api/docs`.

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

The web dev server proxies `/api` and `/socket.io` to the API.

## Docker

Production stack (PostgreSQL, Ollama with a one-shot model pull, and the API image). From the repository root:

```bash
cp .env.example .env   # edit: POSTGRES_PASSWORD, BASIC_AUTH_PASSWORD_HASH, SESSION_SECRET
docker compose up -d --build
docker compose logs -f api
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

Integration specs create a throwaway PostgreSQL cluster in /tmp (unix sockets, migrations applied, torn down after). Nothing touches a developer or production database.

## Layout

- `apps/api` — NestJS 12 API + WebSocket gateway + pg-boss worker
- `apps/web` — React 19 + Vite playground and admin console
- `packages/shared` — zod contracts shared by the API and the web app

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
