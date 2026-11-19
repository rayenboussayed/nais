import { Logger } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AiTask } from '@trainslator/shared';

import type { Env } from '../config/env';
import { defaultModelFor, modelEnvKey } from './tasks';

/**
 * Opaque handle to a loaded pipeline. Structural on purpose: tests stub the
 * loader without importing transformers.js and its native dependencies.
 */
export type PipelineFn = (input: unknown, ...rest: unknown[]) => Promise<unknown>;

/** Resolves the effective model id for a task: `AI_<TASK>_MODEL` override or the registry default. */
export function resolveModelId(
  task: AiTask,
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env[modelEnvKey(task)];
  return override && override.trim().length > 0 ? override.trim() : defaultModelFor(task);
}

/**
 * Lazily loads and memoizes the ONNX pipelines (one per effective model id).
 * Models are downloaded from the Hugging Face Hub on first use (or read from
 * `HF_CACHE_DIR` when set); the process needs the network on first boot or a
 * pre-seeded cache (see `docker-compose.yml` `transformers-init`).
 *
 * The first call per model can take tens of seconds and downloads hundreds of
 * megabytes; subsequent calls are in-process and cheap.
 */
@Injectable()
export class PipelineLoader {
  private readonly logger = new Logger(PipelineLoader.name);
  private readonly pending = new Map<string, Promise<PipelineFn>>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  /** @returns the loaded pipeline for `task`, loading it on first use */
  async load(task: AiTask): Promise<PipelineFn> {
    const model = this.modelFor(task);
    const cached = this.pending.get(model);
    if (cached) return cached;

    const promise = this.loadPipeline(task, model).catch((error: unknown) => {
      // A failed load must not poison the cache; remove the entry so the next call retries.
      this.pending.delete(model);
      throw error;
    });
    this.pending.set(model, promise);
    return promise;
  }

  /** Effective model id for a task (env override or registry default). */
  modelFor(task: AiTask): string {
    return resolveModelId(task, {
      AI_SENTIMENT_MODEL: this.config.get('AI_SENTIMENT_MODEL', { infer: true }),
      AI_SUMMARIZE_MODEL: this.config.get('AI_SUMMARIZE_MODEL', { infer: true }),
      AI_QUESTION_ANSWERING_MODEL: this.config.get('AI_QUESTION_ANSWERING_MODEL', { infer: true }),
      AI_TOKEN_CLASSIFICATION_MODEL: this.config.get('AI_TOKEN_CLASSIFICATION_MODEL', {
        infer: true,
      }),
      AI_ZERO_SHOT_CLASSIFICATION_MODEL: this.config.get('AI_ZERO_SHOT_CLASSIFICATION_MODEL', {
        infer: true,
      }),
      AI_FEATURE_EXTRACTION_MODEL: this.config.get('AI_FEATURE_EXTRACTION_MODEL', { infer: true }),
    });
  }

  private async loadPipeline(task: AiTask, model: string): Promise<PipelineFn> {
    this.logger.log(`loading pipeline task=${task} model=${model}`);
    const started = Date.now();
    const cacheDir = this.config.get('HF_CACHE_DIR', { infer: true });

    // Loaded lazily so the API boots and tests run without the native onnxruntime.
    const module = await import('@huggingface/transformers');
    const options = cacheDir ? { cache_dir: cacheDir } : {};
    // The library overloads pipeline() by task; a string task is valid at runtime.
    const rawPipeline = await (
      module.pipeline as unknown as (
        task: string,
        model: string,
        options?: Record<string, unknown>,
      ) => Promise<unknown>
    )(task, model, options);
    this.logger.log(`pipeline ready task=${task} model=${model} in ${Date.now() - started}ms`);

    return rawPipeline as unknown as PipelineFn;
  }
}
