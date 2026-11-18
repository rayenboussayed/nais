# trainslator

Standalone AI translation service: NestJS 12 + Fastify (REST + WebSocket), Drizzle ORM on PostgreSQL, Ollama for models, React + Vite for the web app.

The service exposes a synchronous REST `POST /api/translate`, an async WebSocket `translate` message flow (cookie or Basic auth), admin REST resources for translations, languages and AI messages, and a Swagger-documented API at `/api/docs`.

## Status

Early development. See `.agent-swarm/PLAN.md` (gitignored) for the build order.

## Commands

```bash
npm ci
npm run build        # workspaces build
npm run typecheck
npm run lint         # zero warnings allowed
npm run test
npm run test:cov     # coverage report
npm run check        # typecheck + lint + build + test + knip
```

Database scripts (available once the API workspace lands):

```bash
npm run db:generate  # drizzle-kit generate (migrations are committed)
npm run db:migrate   # drizzle-kit migrate
npm run db:seed      # idempotent languages seed
```

## Authentication

Single credential, declared as `BASIC_AUTH_USERNAME` / `BASIC_AUTH_PASSWORD_HASH` in `.env` (see `.env.example`). Every HTTP route except `/health` and `POST /api/auth/login` requires it, over `Authorization: Basic` or the HttpOnly `SameSite=Lax` session cookie issued by `/api/auth/login`. WebSocket clients authenticate the same way in the handshake middleware.

## Layout

- `apps/api` — NestJS 12 API + WebSocket gateway
- `apps/web` — React 19 + Vite playground and admin UI
- `packages/shared` — zod contracts shared by the API and the web app

## Deployment

Docker Compose stacks in `docker-compose.yml` (prod) and `docker-compose.dev.yml` (dev); see the `Docker` section of this README once it is filled in by the Docker subtask.
