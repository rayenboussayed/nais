# AGENTS.md — `@trainslator/api`

Refines the repo-root `AGENTS.md` for the API workspace. Read that first:
conventions, quality bar, auth model and the shared lessons live there.
This document holds only what is specific to `apps/api`.

## Commands

From repo root with `-w @trainslator/api`, or from this directory. `db:generate`
writes a new migration from the schema diff; commit its SQL and snapshot
together. Integration specs run with `fileParallelism: false` — full Nest
boots against throwaway clusters; do not parallelize them.

## Hard-won lessons (this workspace)

1. **ESM everywhere.** `"type": "module"`, NodeNext;
   relative imports carry `.js`; two `__dirname` sites use
   `fileURLToPath(import.meta.url)`. Do not remove the extensions.
2. **DI tokens need value imports.** `ConfigService` and any other class used
   as an injection token must be imported with `import { X }`, never
   `import type`. Nest dies with a cryptic "dependency at index N" error —
   the single most recurring boot failure in this repo.
3. **`@nestjs/config` evaluates `loadEnv` at module-decorator time.** Specs
   that need `process.env` set must set it before importing app modules;
   otherwise the spec passes or fails for environmental reasons.
4. **pg-boss connects eagerly.** `boss.start()` runs at module init; anything
   booting against a dead database hangs silently. Health suites use minimal
   modules on purpose.
5. **The prompts are `.txt`, never `.md`.**
   `src/resources/translate/templates/**/{system,human}.txt` are model-facing payloads;
   the markdown linter does not apply to them (`[Tr.: …]` is prompt DSL), and
   no comment may ever be injected into them.
6. **`test/pg-temp.ts` is the only allowed database harness.** Throwaway
   cluster on unix sockets; `PG_BIN` overrides binary discovery; `pg_ctl -w
stop` must be synchronous so the directory removal cannot race shutdown.
7. **Pipelines are lazy, cached by effective model id, with a 30s cooldown**
   after a failed load. Tests stub `PipelineLoader`; the registry, cache
   round-trip and audit trail are covered without network access.
8. **`ai_cache` rows are immutable facts** — keyed by `task + model + sha512`
   over NFC-normalized canonical JSON, plain unique index, refreshed only by
   deletion. The in-tx loser re-reads the winner row instead of double-writing.
9. **Audit payload stores `inputHash`, never raw text.** Privacy by design;
   keep it that way.
10. **Contracts are API-local.** zod schemas live in `src/schemas`; Swagger
    describes them natively and `npm run generate:api` publishes the types.
11. **ONNX pipelines load with the device chain `webgpu` → `cpu`.** Dawn
    (`webgpu` npm package) is glibc-only — the image is
    `node:24-bookworm-slim`, never Alpine. Node has no WASM execution provider
    (the browser bundle only) — don't add `wasm` back without a reason;
    `AI_DEVICE` pins a device and disables the fallback. `ensureWebgpuGlobals`
    is installed lazily and idempotently; Dawn keeps native threads alive, so
    short-lived bins (`bin/transformers-warmup.mjs`) hard-exit instead of
    returning naturally. `GPUDevice` methods are monkey-patched by the package
    to unmap buffers on destroy — don't redeclare them.

12. **Whisper transcription uses node-av, not the ONNX loader.** The STT
    service keeps its native import inside the method, replays the retained
    Buffer for a CPU retry, and closes every handle in `finally`.
    `STT_DEVICE=auto` only attempts GPU when a device node exists; pin `cpu`
    on broken drivers. Route-level body limits belong in
    `configs/body-limit.ts` through Fastify's `onRoute` hook, leaving the
    256 KiB global cap intact.

## Layout rules

- Layout (mirrors `iradable/backend` and `file-fly/packages/backend`):
  request-facing Nest modules in `resources/<domain>/`; cross-cutting
  providers in `modules/<name>/`; guards in `guards/`; the WS gateway lives
  next to its domain (`resources/translate/translate.gateway.ts`); queue
  workers in `modules/queue/`; pure helpers in `utils/`; zod schemas in
  `schemas/`; static literals in `constants/`; framework wiring helpers in
  `configs/`; Drizzle in `db/`; env validation in `environment.ts`.
  Cross-cutting HTTP error handling is `app.exception-filter.ts` (the
  `app.*` root pattern).
- `bin/*.mjs` are plain bins kept out of the instrumented tree; they set
  `process.exitCode` / hard-exit on failure (see inline lint justifications).
- Prompt templates: `src/resources/translate/templates/<variant>/`, loaded at import by
  `src/resources/translate/prompts.ts`.
- `drizzle/`: migrations `NNNN_name/migration.sql` + `snapshot.json`. The
  snapshot is generator-owned (`.prettierignore`); a migration that cannot
  apply on a fresh cluster is broken and may be repaired **before it has ever
  applied** (see `low_nightmare` / `ai_cache` column drop history).

## Invariants — do not break

- `POST /api/translate` keeps the legacy contract; `translate` key derivation
  is sha512 over NFC+trimmed text, base64url; keys are internal only.
- WS `translate` ack is byte-compatible (200 inline / 202 / 400 / 404 / 429 /
  500); the `ai` message mirrors it. Consumer code and tests both rely on the
  exact codes.
- `ai-task` queue: `batchSize: 1`, `retryLimit: 0` — poison jobs fail, never
  retry into the model.
- `apps/api/src/schemas` contracts are the wire shape source of truth;
  never hand-duplicate them in the API or the web.
- Telemetry is opt-in via `OTEL_TRACE_EXPORTER_URL`: without it no OTEL SDK
  is constructed, nothing enters the module graph and `/metrics` never
  binds. With it, the SDK starts in `main.ts` before `NestFactory.create`
  (transport instrumentation) and shuts down in `TelemetryModule`'s
  `onApplicationShutdown` (flush before `useProcessExit` exits). Never start
  it after Nest boots and never shut it down from a raw `process.on`
  handler.
- Coverage: Istanbul provider, 100% global and per-file on
  lines/functions/branches/statements. Every authored `.ts` in this workspace
  is in the denominator; only tests and `*.d.ts` are excluded. Generated
  artifacts (`generated/**`, drizzle snapshots) are checked by CI regeneration
  - `git diff` drift gates, not by instrumentation. Never add an ignore comment
    or a new exclusion to make a gate pass.
