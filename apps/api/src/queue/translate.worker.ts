import { Injectable, Logger } from '@nestjs/common';
import { Job } from '@wavezync/nestjs-pgboss';
import type { JobWithMetadata } from 'pg-boss';

import type { WsTranslateJob } from '@trainslator/shared';

import { TranslateService } from '../translate/translate.service';
import { TranslateGateway, TRANSLATE_QUEUE } from '../ws/translate.gateway';

/**
 * pg-boss worker consuming translate jobs with batchSize 1: one Ollama call
 * at a time, no GPU oversubscription. Re-running a job is safe: translate()
 * is cache-aside and the unique constraint keeps rows single.
 */
@Injectable()
export class TranslateWorker extends Logger {
  constructor(
    private readonly translateService: TranslateService,
    private readonly gateway: TranslateGateway,
  ) {
    super(TranslateWorker.name);
  }

  /**
   * Consumes a batch of translate jobs (configured with batchSize 1).
   * Emits `translation` or `translation-error` to each requesting socket id
   * (omitted when the caller has gone away). Throws on failure so pg-boss
   * marks the job failed rather than looping a poison job.
   */
  @Job(TRANSLATE_QUEUE, { batchSize: 1 }, { retryLimit: 0 })
  async onTranslate(jobs: JobWithMetadata<WsTranslateJob>[]): Promise<void> {
    // pg-boss semantics: throwing marks every job in the batch failed. With the
    // configured batchSize of 1 that is exactly one job, so there is no risk of
    // re-running a successful sibling.
    for (const job of jobs) {
      const { text, targetLanguage, requestId, socketId } = job.data;
      try {
        const result = await this.translateService.translate({ text, targetLanguage });
        if (socketId) {
          this.gateway.emitTo(socketId, 'translation', {
            requestId,
            text: result.text,
            cached: result.cached,
          });
        }
      } catch (error) {
        this.error(
          `translate job failed for requestId=${requestId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        if (socketId) {
          this.gateway.emitTo(socketId, 'translation-error', {
            requestId,
            message: 'Translation failed',
          });
        }
        throw error;
      }
    }
  }
}
