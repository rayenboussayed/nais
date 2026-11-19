# apps/api (`@trainslator/api`)

The trainslator service: NestJS 12 + Fastify 5, REST and WebSocket (socket.io),
Drizzle ORM on PostgreSQL, `@nestjs/ai` with `@ai-sdk/openai-compatible`
against an Ollama `/v1` endpoint, plus dedicated per-task ONNX pipelines via
`@huggingface/transformers` + `onnxruntime-node`. This document covers the
API workspace; repo-wide setup, auth and the Docker stack live in the
[root README](../../README.md).

## Commands

Run from the repo root with `-w @trainslator/api`, or from this directory.

```bash
npm run build              # nest build → dist/
npm run typecheck          # tsc --noEmit
npm start                  # nest start (dev)
npm run start:dev          # nest start --watch
npm run start:prod         # node dist/main.js
npm run db:generate        # drizzle-kit generate (new migration from schema diff)
npm run db:migrate         # apply migrations (idempotent)
npm run db:seed            # upsert the 184-row language catalogue (idempotent)
npm run transformers:warmup # download + smoke the dedicated ONNX pipelines
```

## What it serves

| Surface                               | Path                                            | Auth        |
| ------------------------------------- | ----------------------------------------------- | ----------- |
| Health (unauthenticated)              | `GET /api/health`                               | —           |
| Login / logout                        | `POST /api/auth/login`, `POST /api/auth/logout` | credentials |
| Translate (legacy)                    | `POST /api/translate`                           | required    |
| General AI per task                   | `POST /api/ai/<task>`                           | required    |
| AI task registry                      | `GET /api/ai/tasks`                             | required    |
| Languages catalogue                   | `GET/POST/PATCH/DELETE /api/languages[/:id]`    | required    |
| Audit surface                         | `GET/DELETE /api/ai-messages[/:id[/prompts]]`   | required    |
| Swagger UI / OpenAPI JSON             | `/api/docs`, `/api/docs-json`                   | required    |
| WebSocket (cookie or Basic handshake) | `translate` and `ai` messages                   | required    |

Tasks (`POST /api/ai/<task>`): `translate` (Ollama), `sentiment`, `summarize`,
`question-answering`, `token-classification` (ner, CoNLL-2003),
`zero-shot-classification` and `feature-extraction` (ONNX pipelines). See
`docs/ai-v1.md` in the repo root for the design.

## Environment

Validated at boot (`src/config/env.ts`); the process fails fast on invalid
values in production. Every key has a safe default except `DATABASE_URL` and
`SESSION_SECRET`. Override the dedicated models per task with
`AI_<TASK>_MODEL` (dashes → underscores, e.g. `AI_TOKEN_CLASSIFICATION_MODEL`);
`AI_MAX_CONCURRENCY` caps concurrent model calls (default 2); `AI_DEVICE` pins
the ONNX compute device to `webgpu` or `cpu` (unset = automatic webgpu → cpu
fallback; `wasm` is unsupported in Node). Full list and
the scrypt hash format: `.env.example`.

## Testing

Run from the repo root:

```bash
npm test           # unit + integration (integration specs boot a throwaway PostgreSQL cluster in /tmp via unix sockets)
npm run test:e2e   # process-level smoke (boots dist/main.js)
npm run test:mem   # heap-delta memory test
npm run test:perf  # microbenchmarks
```

Integration specs need a PostgreSQL server binary (`postgresql` Debian
packages) or `PG_BIN` pointing at its `bin` directory. The ONNX pipelines are
never downloaded in tests; the AI suite stubs the loader.

## Layout

- `src/` — modules by feature: `ai/`, `translate/`, `languages/`,
  `translations/`, `ai-messages/`, `auth/`, `database/` (Drizzle + migrations
  tracked in `drizzle/`), `common/` (shared helpers), `config/`, `health/`,
  `http/`, `queue/`, `ws/`.
- `bin/` — plain `.mjs` bins kept out of the instrumented source:
  `db-migrate.mjs`, `db-seed.mjs`, `transformers-warmup.mjs`.
- `test/` — integration specs (`*.integration.spec.ts`) including
  `pg-temp.ts` (throwaway-cluster harness) and `ollama-stub.ts`.
- `bench/` — `vitest bench` microbenchmarks; `docs/perf-baseline.json` is the
  recorded baseline.

## Generated artifacts

`drizzle/**/snapshot.json` is written by `drizzle-kit` and is covered by
`.prettierignore`; never hand-edit it. Migrations must apply on a fresh
cluster — the integration suite proves that. `dist/` is build output; the
image installs with `--ignore-scripts`.
