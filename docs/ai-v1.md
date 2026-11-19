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
9. **Device selection (2026-11-19).** Dedicated pipelines load with an
   automatic device chain: `webgpu` (Dawn, via the `webgpu` npm package — the
   binding is glibc-only, so the image is `node:24-bookworm-slim`, not
   Alpine) → `cpu` (onnxruntime-node). Any load failure on one device falls
   through to the next with a warning; the last error throws (and the 30s
   cooldown applies) when both fail. `AI_DEVICE=webgpu|cpu` pins a single
   device and disables the fallback. `wasm` is not offered: onnxruntime-node
   has no WASM execution provider — verified live (`Unsupported device:
"wasm"`); the WASM path exists only in the browser bundle of
   transformers.js. On GPU-less machines WebGPU detection falls back to CPU
   exactly as designed; on hosts with a GPU (or a software Vulkan such as
   Mesa's lavapipe) the pipeline runs on `device=webgpu` (verified live with
   MiniLM-L6-v2: `device=webgpu` in 13.3s, output dims `[1,384]`).

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

Device chain verified live on 2026-11-19: on a GPU-less machine WebGPU fails
honestly (`No supported adapters`) and the loader fell back to `cpu`; with
Mesa lavapipe (`mesa-vulkan-drivers`) installed the same pipeline ran on
`device=webgpu`. `AI_DEVICE` env pin is honored; `wasm` rejected at boot as
unsupported in Node.

Verification limits: models download at first use (or via the warmup); the
full v1 model set is not pre-downloaded into this checkout. Docker image
build and compose flow remain unverifiable here (no docker daemon) — see the
README Docker section and run `docker compose up -d` on a Docker machine.

## Non-goals (v1)

- GPU passthrough in containers beyond a working device chain (no CUDA/rocm
  image variants yet; WebGPU/CPU only — the chain adapts to whatever adapter
  Dawn finds, including Mesa lavapipe for software execution).
- Image/audio/multimodal tasks (transformers.js supports them; v1 is NLP).
- Opening the service to untrusted networks. Single-credential auth unchanged.
