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
import { and, eq, lt } from 'drizzle-orm';

import type { Database } from '../../db/drizzle.module.js';
import type { Env } from '../../environment.js';
import type { AiTask } from '../../schemas/ai.js';

import { DRIZZLE } from '../../db/drizzle.module.js';
import { aiCache, aiMessages } from '../../db/schema.js';
import { AI_TASKS, aiRequestSchemas, aiTaskSchema } from '../../schemas/ai.js';
import { normalizeResult } from '../../utils/ai-result.js';
import { markAuditFailed } from '../../utils/audit.js';
import { Inflight } from '../../utils/inflight.js';
import { inputHashFor, taskKeyFor } from '../../utils/key.js';
import { Semaphore } from '../../utils/semaphore.js';
import { isTimeoutError, TranslateService } from '../translate/translate.service.js';
import { PipelineLoader } from './pipeline-loader.js';
import { AI_TASK_REGISTRY, listTaskDescriptors, modelEnvKey } from './tasks.js';

const AUDIT_RESPONSE_CAP = 10_000;

export interface AiRunEnvelope {
  cached: boolean;
  /** Effective model id the result came from (or would come from on miss). */
  model: string;
  /** Task-shaped result object; always carries `cached`. */
  result: Record<string, unknown>;
  task: AiTask;
}

/**
 * General-purpose AI pipeline: task registry resolution, per-task input/output
 * validation, cache-aside (`ai_cache` for dedicated tasks, the translations
 * catalogue for `translate`), unified audit trail (`ai_messages`), and
 * single-flight deduplication of identical invocations.
 */
@Injectable()
export class AiService implements OnModuleInit {
  private readonly inflight = new Inflight<string, AiRunEnvelope>();
  private readonly logger = new Logger(AiService.name);
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
   * Public descriptor list for `GET /api/ai/tasks`.
   * @returns one descriptor per registered task with its effective model
   */
  listTasks() {
    return listTaskDescriptors((task) => this.modelFor(task)).map((descriptor) => ({
      description: descriptor.description,
      label: descriptor.label,
      model: descriptor.model,
      provider: descriptor.provider,
      task: descriptor.task,
    }));
  }

  /**
   * Effective model id for a task (env override or registry default).
   * @param task - the task whose effective model to resolve
   * @returns the effective model id
   */
  modelFor(task: AiTask): string {
    if (task === 'translate') {
      return this.config.get('OLLAMA_TEXT_MODEL', { infer: true });
    }
    return this.loader.modelFor(task);
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

  /**
   * Read-only cache probe for inline 200 answers; never loads the model or
   * writes audit rows. Returns the cached task result or null.
   * @param task - the task to look up in `ai_cache`
   * @param input - the task input to key the cache on
   * @returns the cached result with `cached: true`, or null on a miss
   */
  async peekCache(
    task: Exclude<AiTask, 'translate'>,
    input: Record<string, unknown>,
  ): Promise<null | Record<string, unknown>> {
    const model = this.loader.modelFor(task);
    const cacheKey = taskKeyFor(task, model, input);
    const rows = await this.db
      .select({ result: aiCache.result })
      .from(aiCache)
      .where(and(eq(aiCache.task, task), eq(aiCache.model, model), eq(aiCache.key, cacheKey)))
      .limit(1);
    const row = rows[0];
    return row ? { ...row.result, cached: true } : null;
  }

  /**
   * Runs a task. `translate` is served by the catalogue-cached translate
   * pipeline; every other task runs a dedicated ONNX pipeline with an
   * `ai_cache`-aside lookup.
   * @param taskRaw - the task id from the wire (validated before use)
   * @param inputRaw - the task input from the wire (validated before use)
   * @returns the task result envelope (inline result + audit metadata)
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

    // eslint-disable-next-line security/detect-object-injection -- task narrowed to AiTask by aiTaskSchema above
    const input = aiRequestSchemas[task].parse(inputRaw) as unknown as Record<string, unknown>;
    const model = this.loader.modelFor(task);
    const cacheKey = taskKeyFor(task, model, input);

    const cached = await this.db
      .select({ result: aiCache.result })
      .from(aiCache)
      .where(and(eq(aiCache.task, task), eq(aiCache.model, model), eq(aiCache.key, cacheKey)))
      .limit(1);
    if (cached[0]) {
      return { cached: true, model, result: { ...cached[0].result, cached: true }, task };
    }

    return this.inflight.run(`${task}:${cacheKey}`, () =>
      this.runWithAudit(task, model, cacheKey, input),
    );
  }

  /**
   * Calls the pipeline with task-specific arguments.
   * @param pipeline - the loaded transformers.js pipeline callable
   * @param task - the task being invoked
   * @param input - the validated task input
   * @returns the raw pipeline output (normalization happens in the caller)
   */
  private async invokePipeline(
    pipeline: (input: unknown, ...rest: unknown[]) => Promise<unknown>,
    task: Exclude<AiTask, 'translate'>,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    switch (task) {
      case 'feature-extraction':
        return pipeline(input.text as string, { normalize: true, pooling: 'mean' });
      case 'question-answering':
        return pipeline(input.question as string, input.context as string);
      case 'sentiment':
        return pipeline(input.text as string);
      case 'summarize':
        return pipeline(input.text as string, { max_new_tokens: 100 });
      case 'token-classification':
        return pipeline(input.text as string, { aggregation_strategy: 'simple' });
      case 'zero-shot-classification':
        return pipeline(input.text as string, input.candidateLabels as string[]);
    }
  }

  private async runTranslate(inputRaw: unknown): Promise<AiRunEnvelope> {
    const input = aiRequestSchemas.translate.parse(inputRaw);
    const response = await this.translateService.translate({
      targetLanguage: input.targetLanguage,
      text: input.text,
    });
    return {
      cached: response.cached,
      model: this.modelFor('translate'),
      result: { cached: response.cached, text: response.text },
      task: 'translate',
    };
  }

  private async runWithAudit(
    task: Exclude<AiTask, 'translate'>,
    model: string,
    cacheKey: string,
    input: Record<string, unknown>,
  ): Promise<AiRunEnvelope> {
    // eslint-disable-next-line security/detect-object-injection -- task narrowed to AiTask by aiTaskSchema at run() entry
    const provider = AI_TASK_REGISTRY[task].provider;
    const inserted = await this.db
      .insert(aiMessages)
      .values({
        model,
        // Privacy posture: the audit stores a hash of the input plus its shape — never the raw text.
        payload: {
          inputHash: inputHashFor(input),
          inputKeys: Object.keys(input).sort(),
          requestBytes: Buffer.byteLength(JSON.stringify(input), 'utf8'),
        },
        provider,
        status: 'processing',
        task,
      })
      .returning({ id: aiMessages.id });
    const message = inserted[0];
    if (!message) throw new Error('ai_messages insert returned no row');

    try {
      // The model gate bounds concurrent dedicated-model calls on the REST path.
      const result = await this.modelGate.run(async () => {
        const pipeline = await this.loader.load(task);
        const raw = await this.invokePipeline(pipeline, task, input);
        return normalizeResult(task, raw);
      });

      // Two concurrent identical jobs may both reach the insert; the unique
      // index decides. The loser re-reads the winner's immutable row so every
      // caller gets the same result and the audit row matches what was served.
      let finalResult = result;
      await this.db.transaction(async (tx) => {
        const insertedRows = await tx
          .insert(aiCache)
          .values({ key: cacheKey, model, result, task })
          .onConflictDoNothing()
          .returning({ id: aiCache.id });
        if (insertedRows.length === 0) {
          const winner = await tx
            .select({ result: aiCache.result })
            .from(aiCache)
            .where(and(eq(aiCache.task, task), eq(aiCache.model, model), eq(aiCache.key, cacheKey)))
            .limit(1);
          const winnerResult = winner[0]?.result;
          if (winnerResult) finalResult = winnerResult as Record<string, unknown>;
        }
        await tx
          .update(aiMessages)
          .set({
            response: JSON.stringify(finalResult).slice(0, AUDIT_RESPONSE_CAP),
            status: 'completed',
            updatedAt: new Date(),
          })
          .where(eq(aiMessages.id, message.id));
      });

      return { cached: false, model, result: { ...finalResult, cached: false }, task };
    } catch (error) {
      await markAuditFailed(this.db, message.id, (auditMessage) => this.logger.error(auditMessage));

      if (isTimeoutError(error)) {
        throw new GatewayTimeoutException('The AI task timed out');
      }
      throw new BadGatewayException('The AI task failed');
    }
  }
}

/**
 * Accepted model ids: "org/model" from the Hub, or absolute/relative local paths; nothing else.
 * @param model - the model id from `AI_<TASK>_MODEL` or the registry default
 * @returns true when the id is a Hub id or a local path
 */
function isValidModelId(model: string): boolean {
  const orgAndName = /^[A-Z0-9][\w.-]*\/[A-Z0-9][\w.-]*$/i;
  const localPath = /^\.{0,2}\/[^\0]*$/;
  return orgAndName.test(model) || localPath.test(model);
}
