import type { AiTask } from '@trainslator/shared';

import { Logger } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../environment.js';

import { resolveDeviceChain } from './device.js';
import { defaultModelFor, modelEnvKey } from './tasks.js';
import { ensureWebgpuGlobals } from './webgpu-globals.js';

/**
 * Opaque handle to a loaded pipeline. Structural on purpose: tests stub the
 * loader without importing transformers.js and its native dependencies.
 */
export type PipelineFn = (input: unknown, ...rest: unknown[]) => Promise<unknown>;

/**
 * Lazily loads and memoizes the ONNX pipelines (one per effective model id).
 * Models are downloaded from the Hugging Face Hub on first use (or read from
 * `HF_CACHE_DIR` when set); the process needs the network on first boot or a
 * pre-seeded cache (see `docker-compose.yml` `transformers-init`).
 *
 * The first call per model can take tens of seconds and downloads hundreds of
 * megabytes; subsequent calls are in-process and cheap.
 *
 * Each load attempts the device chain `webgpu` → `cpu` (see
 * `resolveDeviceChain`); `AI_DEVICE` pins a single device and disables the
 * fallback. Discovery failures on one device fall through to the next with a
 * warning; the last error is thrown (and the retry cooldown applies) when
 * every device fails.
 */
@Injectable()
export class PipelineLoader {
  /** How long to wait before re-attempting a failed model download. */
  private static readonly RETRY_COOLDOWN_MS = 30_000;
  /** model id -> time the last load failed; used to bound retry storms. */
  private readonly failureAt = new Map<string, number>();
  private readonly logger = new Logger(PipelineLoader.name);

  private readonly pending = new Map<string, Promise<PipelineFn>>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * @param task - the task whose pipeline to load
   * @returns the loaded pipeline for `task`, loading it on first use
   * @throws Error when a recent attempt for the same model failed within the cooldown window
   */
  async load(task: AiTask): Promise<PipelineFn> {
    const model = this.modelFor(task);
    const cached = this.pending.get(model);
    if (cached) return cached;

    const failAt = this.failureAt.get(model);
    if (failAt && Date.now() - failAt < PipelineLoader.RETRY_COOLDOWN_MS) {
      const wait = Math.ceil((PipelineLoader.RETRY_COOLDOWN_MS - (Date.now() - failAt)) / 1000);
      throw new Error(`pipeline for model "${model}" recently failed; retry in ${wait}s`);
    }

    const promise = this.loadPipeline(task, model).catch((error: unknown) => {
      // A failed load must not poison the pending cache; record the failure for the cooldown.
      this.pending.delete(model);
      this.failureAt.set(model, Date.now());
      throw error;
    });
    this.pending.set(model, promise);
    return promise;
  }

  /**
   * Effective model id for a task (env override or registry default).
   * @param task - the task whose effective model to resolve
   * @returns the effective model id
   */
  modelFor(task: AiTask): string {
    return resolveModelId(task, {
      AI_FEATURE_EXTRACTION_MODEL: this.config.get('AI_FEATURE_EXTRACTION_MODEL', { infer: true }),
      AI_QUESTION_ANSWERING_MODEL: this.config.get('AI_QUESTION_ANSWERING_MODEL', { infer: true }),
      AI_SENTIMENT_MODEL: this.config.get('AI_SENTIMENT_MODEL', { infer: true }),
      AI_SUMMARIZE_MODEL: this.config.get('AI_SUMMARIZE_MODEL', { infer: true }),
      AI_TOKEN_CLASSIFICATION_MODEL: this.config.get('AI_TOKEN_CLASSIFICATION_MODEL', {
        infer: true,
      }),
      AI_ZERO_SHOT_CLASSIFICATION_MODEL: this.config.get('AI_ZERO_SHOT_CLASSIFICATION_MODEL', {
        infer: true,
      }),
    });
  }

  private async loadPipeline(task: AiTask, model: string): Promise<PipelineFn> {
    const cacheDir = this.config.get('HF_CACHE_DIR', { infer: true });
    // Loaded lazily so the API boots and tests run without the native onnxruntime.
    const module = await import('@huggingface/transformers');
    const chain = resolveDeviceChain(this.config.get('AI_DEVICE', { infer: true }));
    let lastError: unknown;
    for (const device of chain) {
      const started = Date.now();
      try {
        if (device === 'webgpu') {
          // Throws when the Dawn binding cannot load; that is the WebGPU path being unavailable, not a boot failure.
          await ensureWebgpuGlobals();
        }
        this.logger.log(`loading pipeline task=${task} model=${model} device=${device}`);
        const options = { ...(cacheDir ? { cache_dir: cacheDir } : {}), device };
        // The library overloads pipeline() by task; a string task is valid at runtime.
        const rawPipeline = await (
          module.pipeline as unknown as (
            task: string,
            model: string,
            options?: Record<string, unknown>,
          ) => Promise<unknown>
        )(task, model, options);
        this.logger.log(
          `pipeline ready task=${task} model=${model} device=${device} in ${Date.now() - started}ms`,
        );
        return rawPipeline as unknown as PipelineFn;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `pipeline load failed task=${task} model=${model} device=${device}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    throw lastError;
  }
}

/**
 * Reads one narrow environment variable at module-import time with a safe
 * fallback. Only for values that must be known before Nest boots (decorator
 * options, prompt template choice, telemetry gate, model-id overrides).
 * This is deliberately not a validator: required values stay validated by
 * `validateEnv` at boot, and no full validation happens at import time.
 * @param key - the environment variable name
 * @param fallback - value returned when the variable is unset (default: empty string)
 * @param source - env map to read from (defaults to `process.env`)
 * @returns the raw value or `fallback` when unset
 */
export function importTimeEnv(
  key: string,
  fallback: string = '',
  source: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' ? value : fallback;
}

/**
 * Resolves the effective model id for a task: `AI_<TASK>_MODEL` override or the registry default.
 * @param task - the task whose effective model to resolve
 * @param env - the env map to read overrides from (defaults to process.env)
 * @returns the effective model id
 */
export function resolveModelId(
  task: AiTask,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = importTimeEnv(modelEnvKey(task), '', env);
  return override.trim().length > 0 ? override.trim() : defaultModelFor(task);
}
