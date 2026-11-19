import type { AiTaskJob } from '@trainslator/shared';
import type { JobWithMetadata } from 'pg-boss';

import { Injectable, Logger } from '@nestjs/common';
import { aiTaskJobSchema } from '@trainslator/shared';
import { Job } from '@wavezync/nestjs-pgboss';

import { AiService } from '../ai/ai.service.js';
import { TranslateGateway } from '../ws/translate.gateway.js';
import { AI_TASK_QUEUE } from './ai-task-queue.constants.js';

/**
 * pg-boss worker consuming `ai-task` jobs with batchSize 1: one model call at
 * a time, no GPU oversubscription. Re-running a job is safe: every task is
 * cache-aside and the unique indexes keep rows single.
 * Emits `translation`/`translation-error` for the translate task (unchanged
 * legacy contract) and `ai-result`/`ai-error` for the dedicated tasks.
 */
@Injectable()
export class AiTaskWorker extends Logger {
  constructor(
    private readonly ai: AiService,
    private readonly gateway: TranslateGateway,
  ) {
    super(AiTaskWorker.name);
  }

  /**
   * Consumes one job; batches with more than one job are not expected.
   * @param jobs - the job batch (pg-boss delivers one for ai-task)
   */
  @Job(AI_TASK_QUEUE, { batchSize: 1 }, { retryLimit: 0 })
  async onAiTask(jobs: JobWithMetadata<AiTaskJob>[]): Promise<void> {
    for (const job of jobs) {
      await this.runJob(job);
    }
  }

  private async runJob(job: JobWithMetadata<AiTaskJob>): Promise<void> {
    // Defense in depth: pg-boss hands us whatever was enqueued; re-validate.
    const parsed = aiTaskJobSchema.safeParse(job.data);
    if (!parsed.success) {
      this.error(
        `ai task job payload rejected: ${parsed.error.issues[0]?.message ?? 'invalid payload'}`,
      );
      throw new Error('ai task job payload rejected');
    }
    const { input, requestId, socketId, task } = parsed.data;
    try {
      const envelope = await this.ai.run(task, input);
      if (!socketId) return;
      if (task === 'translate') {
        const text = typeof envelope.result.text === 'string' ? envelope.result.text : '';
        this.gateway.emitTo(socketId, 'translation', {
          cached: envelope.cached,
          requestId,
          text,
        });
      } else {
        this.gateway.emitTo(socketId, 'ai-result', {
          cached: envelope.cached,
          requestId,
          result: envelope.result,
          task,
        });
      }
    } catch (error) {
      this.error(
        `ai task failed task=${task} requestId=${requestId}: ${
          error instanceof Error ? error.name : 'unknown error'
        }`,
      );
      if (!socketId) throw error; // no requester: still mark the job failed

      if (task === 'translate') {
        this.gateway.emitTo(socketId, 'translation-error', {
          message: 'Translation failed',
          requestId,
        });
      } else {
        this.gateway.emitTo(socketId, 'ai-error', {
          message: 'AI task failed',
          requestId,
          task,
        });
      }
      throw error;
    }
  }
}
