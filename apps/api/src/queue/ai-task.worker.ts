import { Injectable, Logger } from '@nestjs/common';

import type { JobWithMetadata } from 'pg-boss';
import { Job } from '@wavezync/nestjs-pgboss';

import type { AiTaskJob } from '@trainslator/shared';

import { AiService } from '../ai/ai.service';
import { AI_TASK_QUEUE } from './ai-task-queue.constants';
import { TranslateGateway } from '../ws/translate.gateway';

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

  /** Consumes one job; batches with more than one job are not expected. */
  @Job(AI_TASK_QUEUE, { batchSize: 1 }, { retryLimit: 0 })
  async onAiTask(jobs: JobWithMetadata<AiTaskJob>[]): Promise<void> {
    for (const job of jobs) {
      await this.runJob(job);
    }
  }

  private async runJob(job: JobWithMetadata<AiTaskJob>): Promise<void> {
    const { task, input, requestId, socketId } = job.data;
    try {
      const envelope = await this.ai.run(task, input);
      if (!socketId) return;
      if (task === 'translate') {
        const text = typeof envelope.result.text === 'string' ? envelope.result.text : '';
        this.gateway.emitTo(socketId, 'translation', {
          requestId,
          text,
          cached: envelope.cached,
        });
      } else {
        this.gateway.emitTo(socketId, 'ai-result', {
          requestId,
          task,
          result: envelope.result,
          cached: envelope.cached,
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
          requestId,
          message: 'Translation failed',
        });
      } else {
        this.gateway.emitTo(socketId, 'ai-error', {
          requestId,
          task,
          message: 'AI task failed',
        });
      }
      throw error;
    }
  }
}
