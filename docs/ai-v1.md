# General-purpose AI service — design (v1)

Evolves trainslator from a translation-only API into a general-purpose AI
service. Translation remains a first-class citizen with identical behavior;
everything else rides on the same pipeline: task registry, cache-aside,
audit, inflight dedup, queue, WS.

## Decisions (from the request + research, 2026-11-19)

1. **Providers.** Ollama stays the LLM provider (translation catalogue path,
   open-ended generation). transformers.js (`@huggingface/transformers` +
   `onnxruntime-node`) serves **dedicated ONNX models per task** — the
   "one model per task" mapping from huggingface.co/docs/transformers.js.
   v1 ships: sentiment (`Xenova/distilbert-base-uncased-finetuned-sst-2-english`),
   summarize (`Xenova/distilbart-cnn-6-6`), question-answering
   (`Xenova/distilbert-base-uncased-distilled-squad`), token-classification
   (`Xenova/bert-base-NER`), zero-shot-classification
   (`Xenova/nli-deberta-v3-xsmall`), feature-extraction
   (`onnx-community/all-MiniLM-L6-v2-ONNX`).
   Per-task model override via `AI_<TASK>_MODEL` env vars; pipelines lazy-load.
2. **Unified pipeline** (`AiService.run`): task registry (zod input/output
   schemas + provider + default model) → cache-aside → audit row → inflight
   dedup. Translation delegates to the existing catalogue-cached service.
3. **Cache.** New `ai_cache` table (task, model, sha512 key, result jsonb),
   partial unique index, soft delete. Translations table unchanged and keeps
   caching `translate`; all other tasks use `ai_cache`.
4. **Audit.** `ai_messages` gains `task` (default `'translate'`) and
   `payload jsonb` — one audit table for every model call, all statuses.
5. **REST.** `POST /api/ai/<task>` per task (concrete routes so Swagger picks
   up zod→Standard Schema automatically), plus `GET /api/ai/tasks`. Legacy
   `/api/translate` remains (deprecated, `Deprecation: true` header).
6. **WS.** New `ai` message `{ task, input, requestId }`, same ack contract
   (200 inline / 202 queued / 400 / 404 unknown task / 429 / 500) and
   `ai-result` / `ai-error` events. `translate` message untouched. Worker on
   the `ai-task` queue (batchSize 1); the old `translate` queue is retired.
7. **Web.** New `/studio` route: task picker + per-task form, same styling.
8. **Models in Docker.** `HF_CACHE_DIR` volume; one-shot `transformers-init`
   service pre-downloads the v1 task models (ollama-init parity).

## Implementation status (2026-11-19)

Everything above is implemented and green in the repo: shared contracts
(`packages/shared/src/ai.ts`), the DB migration (`ai_cache`, `ai_messages.task`,
`ai_messages.payload`), the task registry + `PipelineLoader` (lazy memoized
pipelines), `AiService` (cache-aside + inflight dedup + unified audit), REST
routes for all seven tasks + `GET /api/ai/tasks`, the WS `ai` message with the
same ack contract, the `ai-task` pg-boss queue, the web `/studio` route, the
`transformers-init` compose one-shot and `apps/api/bin/transformers-warmup.mjs`
(both proven against live pipelines: **all six download and run** —
warmup completed green in 372s on this network).

Verification limits: models download at first use (or via the warmup); the
full v1 model set is not pre-downloaded into this checkout. Docker image
build and compose flow remain unverifiable here (no docker daemon) — see the
README Docker section and run `docker compose up -d` on a Docker machine.

## Non-goals (v1)

- GPU provisioning inside containers (CPU/WASM only; WebGPU documented for
  browser experiments).
- Image/audio/multimodal tasks (transformers.js supports them; v1 is NLP).
- Opening the service to untrusted networks. Single-credential auth unchanged.
