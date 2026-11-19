import {
  BadGatewayException,
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { eq, and, lt } from 'drizzle-orm';

import type { AiTask } from '@trainslator/shared';
import { aiTaskSchema, aiRequestSchemas, aiResultSchemas } from '@trainslator/shared';

import { DRIZZLE } from '../database/drizzle.module.js';
import type { Database } from '../database/drizzle.module.js';
import { aiCache, aiMessages } from '../database/schema.js';
import { Inflight } from '../common/inflight.js';
import { Semaphore } from '../common/semaphore.js';
import { inputHashFor, taskKeyFor } from '../common/key.js';
import { isTimeoutError, TranslateService } from '../translate/translate.service.js';
import type { Env } from '../config/env.js';
import { AI_TASK_REGISTRY, listTaskDescriptors, modelEnvKey } from './tasks.js';
import { AI_TASKS } from '@trainslator/shared';
import { PipelineLoader } from './pipeline-loader.js';

const AUDIT_RESPONSE_CAP = 10_000;

export interface AiRunEnvelope {
  task: AiTask;
  /** Task-shaped result object; always carries `cached`. */
  result: Record<string, unknown>;
  cached: boolean;
  /** Effective model id the result came from (or would come from on miss). */
  model: string;
}

/**
 * General-purpose AI pipeline: task registry resolution, per-task input/output
 * validation, cache-aside (`ai_cache` for dedicated tasks, the translations
 * catalogue for `translate`), unified audit trail (`ai_messages`), and
 * single-flight deduplication of identical invocations.
 */
@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private readonly inflight = new Inflight<string, AiRunEnvelope>();
  private readonly modelGate: Semaphore;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly translateService: TranslateService,
    private readonly loader: PipelineLoader,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.modelGate = new Semaphore(this.config.get('AI_MAX_CONCURRENCY', { infer: true }));
  }

  /**
   * Fails fast on a misconfigured `AI_<TASK>_MODEL` (garbage id, protocol smuggling),
   * then marks stale `processing` audit rows as failed. Fails soft on the latter.
   */
  async onModuleInit(): Promise<void> {
    for (const task of AI_TASKS) {
      if (task === 'translate') continue;
      const model = this.modelFor(task);
      if (!isValidModelId(model)) {
        throw new Error(
          `Invalid ${modelEnvKey(task)} "${model}" — expected "org/model" (org and model: alphanumeric, '-', '_', '.', single segment each), or an absolute/relative path for local models`,
        );
      }
    }
    try {
      const rows = await this.db
        .update(aiMessages)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(
          and(
            eq(aiMessages.status, 'processing'),
            lt(aiMessages.createdAt, new Date(Date.now() - 10 * 60 * 1000)),
          ),
        )
        .returning({ id: aiMessages.id });
      if (rows.length > 0) {
        this.logger.warn(`reaped ${rows.length} stale audit row(s)`);
      }
    } catch (error) {
      this.logger.error(
        `stale audit reaper skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  /** Public descriptor list for `GET /api/ai/tasks`. */
  listTasks() {
    return listTaskDescriptors((task) => this.modelFor(task)).map((descriptor) => ({
      task: descriptor.task,
      provider: descriptor.provider,
      model: descriptor.model,
      label: descriptor.label,
      description: descriptor.description,
    }));
  }

  /**
   * Read-only cache probe for inline 200 answers; never loads the model or
   * writes audit rows. Returns the cached task result or null.
   */
  async peekCache(
    task: Exclude<AiTask, 'translate'>,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> {
    const model = this.loader.modelFor(task);
    const cacheKey = taskKeyFor(task, model, input);
    const rows = await this.db
      .select({ result: aiCache.result })
      .from(aiCache)
      .where(
        and(
          eq(aiCache.task, task),
          eq(aiCache.model, model),
          eq(aiCache.key, cacheKey),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? { ...row.result, cached: true } : null;
  }

  /** Effective model id for a task (env override or registry default). */
  modelFor(task: AiTask): string {
    if (task === 'translate') {
      return this.config.get('OLLAMA_TEXT_MODEL', { infer: true });
    }
    return this.loader.modelFor(task);
  }

  /**
   * Runs a task. `translate` is served by the catalogue-cached translate
   * pipeline; every other task runs a dedicated ONNX pipeline with an
   * `ai_cache`-aside lookup.
   *
   * @throws NotFoundException for an unknown task
   * @throws BadRequestException (via the caller's zod validation) for bad input
   * @throws BadGatewayException | GatewayTimeoutException when the model fails
   */
  async run(taskRaw: string, inputRaw: unknown): Promise<AiRunEnvelope> {
    const parsedTask = aiTaskSchema.safeParse(taskRaw);
    if (!parsedTask.success) {
      throw new NotFoundException(`Unknown AI task: ${String(taskRaw)}`);
    }
    const task = parsedTask.data;
    if (task === 'translate') return this.runTranslate(inputRaw);

    const input = aiRequestSchemas[task].parse(inputRaw) as unknown as Record<string, unknown>;
    const model = this.loader.modelFor(task);
    const cacheKey = taskKeyFor(task, model, input);

    const cached = await this.db
      .select({ result: aiCache.result })
      .from(aiCache)
      .where(
        and(
          eq(aiCache.task, task),
          eq(aiCache.model, model),
          eq(aiCache.key, cacheKey),
        ),
      )
      .limit(1);
    if (cached[0]) {
      return { task, result: { ...cached[0].result, cached: true }, cached: true, model };
    }

    return this.inflight.run(`${task}:${cacheKey}`, () =>
      this.runWithAudit(task, model, cacheKey, input),
    );
  }

  private async runTranslate(inputRaw: unknown): Promise<AiRunEnvelope> {
    const input = aiRequestSchemas.translate.parse(inputRaw);
    const response = await this.translateService.translate({
      text: input.text,
      targetLanguage: input.targetLanguage,
    });
    return {
      task: 'translate',
      result: { text: response.text, cached: response.cached },
      cached: response.cached,
      model: this.modelFor('translate'),
    };
  }

  private async runWithAudit(
    task: Exclude<AiTask, 'translate'>,
    model: string,
    cacheKey: string,
    input: Record<string, unknown>,
  ): Promise<AiRunEnvelope> {
    const provider = AI_TASK_REGISTRY[task].provider;
    const inserted = await this.db
      .insert(aiMessages)
      .values({
        task,
        provider,
        model,
        status: 'processing',
        // Privacy posture: the audit stores a hash of the input plus its shape — never the raw text.
        payload: {
          inputHash: inputHashFor(input),
          inputKeys: Object.keys(input).sort(),
          requestBytes: Buffer.byteLength(JSON.stringify(input), 'utf8'),
        },
      })
      .returning({ id: aiMessages.id });
    const message = inserted[0];
    if (!message) throw new Error('ai_messages insert returned no row');

    try {
      // The model gate bounds concurrent dedicated-model calls on the REST path.
      const result = await this.modelGate.run(async () => {
        const pipeline = await this.loader.load(task);
        const raw = await this.invokePipeline(pipeline, task, input);
        return this.normalizeResult(task, raw);
      });

      // Two concurrent identical jobs may both reach the insert; the unique
      // index decides. The loser re-reads the winner's immutable row so every
      // caller gets the same result and the audit row matches what was served.
      let finalResult = result;
      await this.db.transaction(async (tx) => {
        const insertedRows = await tx
          .insert(aiCache)
          .values({ task, model, key: cacheKey, result })
          .onConflictDoNothing()
          .returning({ id: aiCache.id });
        if (insertedRows.length === 0) {
          const winner = await tx
            .select({ result: aiCache.result })
            .from(aiCache)
            .where(
              and(
                eq(aiCache.task, task),
                eq(aiCache.model, model),
                eq(aiCache.key, cacheKey),
              ),
            )
            .limit(1);
          const winnerResult = winner[0]?.result;
          if (winnerResult) finalResult = winnerResult as Record<string, unknown>;
        }
        await tx
          .update(aiMessages)
          .set({
            status: 'completed',
            response: JSON.stringify(finalResult).slice(0, AUDIT_RESPONSE_CAP),
            updatedAt: new Date(),
          })
          .where(eq(aiMessages.id, message.id));
      });

      return { task, result: { ...finalResult, cached: false }, cached: false, model };
    } catch (error) {
      await this.db
        .update(aiMessages)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(aiMessages.id, message.id))
        .catch((secondaryError: unknown) => {
          // Best-effort audit; never mask the original failure with a database error.
          this.logger.error(
            `audit row ${message.id} could not be marked failed: ${
              secondaryError instanceof Error ? secondaryError.name : 'unknown error'
            }`,
          );
        });

      if (isTimeoutError(error)) {
        throw new GatewayTimeoutException('The AI task timed out');
      }
      throw new BadGatewayException('The AI task failed');
    }
  }

  /** Calls the pipeline with task-specific arguments. */
  private async invokePipeline(
    pipeline: (input: unknown, ...rest: unknown[]) => Promise<unknown>,
    task: Exclude<AiTask, 'translate'>,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    switch (task) {
      case 'sentiment':
        return pipeline(input.text as string);
      case 'summarize':
        return pipeline(input.text as string, { max_new_tokens: 100 });
      case 'question-answering':
        return pipeline(input.question as string, input.context as string);
      case 'token-classification':
        return pipeline(input.text as string, { aggregation_strategy: 'simple' });
      case 'zero-shot-classification':
        return pipeline(input.text as string, input.candidateLabels as string[]);
      case 'feature-extraction':
        return pipeline(input.text as string, { pooling: 'mean', normalize: true });
    }
  }

  /** Normalizes raw pipeline output into the task's shared result schema. */
  private normalizeResult(
    task: Exclude<AiTask, 'translate'>,
    raw: unknown,
  ): Record<string, unknown> {
    switch (task) {
      case 'sentiment': {
        const first = this.firstItem(raw, task);
        return aiResultSchemas.sentiment.parse({
          label: String(first.label ?? ''),
          score: Number(first.score ?? 0),
          cached: false,
        });
      }
      case 'summarize': {
        const first = this.firstItem(raw, task);
        return aiResultSchemas.summarize.parse({
          text: String(first.summary_text ?? '').trim(),
          cached: false,
        });
      }
      case 'question-answering': {
        const item = this.singleItem(raw, task);
        return aiResultSchemas['question-answering'].parse({
          answer: String(item.answer ?? ''),
          score: Number(item.score ?? 0),
          start: Number(item.start ?? 0),
          end: Number(item.end ?? 0),
          cached: false,
        });
      }
      case 'token-classification': {
        const items = this.arrayItems(raw, task);
        return aiResultSchemas['token-classification'].parse({
          entities: items.map((item) => ({
            word: String(item.word ?? ''),
            entity_group: String(item.entity_group ?? item.entity ?? ''),
            score: Number(item.score ?? 0),
            start: Number(item.start ?? 0),
            end: Number(item.end ?? 0),
          })),
          cached: false,
        });
      }
      case 'zero-shot-classification': {
        // The pipeline returns a single object for a single input string.
        const item = this.singleItem(raw, task);
        return aiResultSchemas['zero-shot-classification'].parse({
          sequence: String(item.sequence ?? ''),
          labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label)) : [],
          scores: Array.isArray(item.scores) ? item.scores.map((score) => Number(score ?? 0)) : [],
          cached: false,
        });
      }
      case 'feature-extraction': {
        const embedding = this.tensorToArray(raw);
        return aiResultSchemas['feature-extraction'].parse({
          embedding,
          dimensions: embedding.length,
          cached: false,
        });
      }
    }
  }

  private firstItem(raw: unknown, task: AiTask): Record<string, unknown> {
    const items = this.arrayItems(raw, task);
    const first = items[0];
    if (!first) throw new BadGatewayException(`The ${task} model returned no output`);
    return first;
  }

  private singleItem(raw: unknown, task: AiTask): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new BadGatewayException(`The ${task} model returned an unexpected shape`);
    }
    return raw as Record<string, unknown>;
  }

  private arrayItems(raw: unknown, task: AiTask): Array<Record<string, unknown>> {
    if (!Array.isArray(raw)) {
      throw new BadGatewayException(`The ${task} model returned an unexpected shape`);
    }
    return raw as Array<Record<string, unknown>>;
  }

  /** Extracts a flat embedding vector from a transformers.js Tensor-like object. */
  private tensorToArray(raw: unknown): number[] {
    if (typeof raw !== 'object' || raw === null) {
      throw new BadGatewayException('The feature-extraction model returned an unexpected shape');
    }
    const tensor = raw as {
      tolist?: () => unknown;
      data?: { length: number } | Float32Array | Array<number> | ArrayLike<number>;
    };
    if (typeof tensor.tolist === 'function') {
      const listed = tensor.tolist();
      const flat = this.firstVector(listed);
      if (flat) return flat;
    }
    const data = tensor.data;
    if (data && ArrayLikeCheck(data)) {
      // Number() also accepts BigInt entries from int8/uint8 quantized tensors.
      return Array.from(data as ArrayLike<number | bigint>, (value) => Number(value));
    }
    throw new BadGatewayException('The feature-extraction model returned an unexpected shape');
  }

  private firstVector(listed: unknown): number[] | null {
    if (!Array.isArray(listed) || listed.length === 0) return null;
    const first = listed[0] as unknown;
    if (Array.isArray(first) && first.length > 0 && typeof first[0] === 'number') {
      return first as number[];
    }
    if (typeof first === 'number') return listed as number[];
    return null;
  }
}

/** ArrayLike narrowing with an explicit check of the length property. */
function ArrayLikeCheck(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'length' in value &&
    typeof (value as { length: unknown }).length === 'number'
  );
}

/** Accepted model ids: "org/model" from the Hub, or absolute/relative local paths; nothing else. */
function isValidModelId(model: string): boolean {
  const orgAndName = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
  const localPath = /^(\.{0,2}\/|\/)[^\0]*$/;
  return orgAndName.test(model) || localPath.test(model);
}
