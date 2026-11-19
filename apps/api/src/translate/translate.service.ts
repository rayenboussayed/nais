import {
  GatewayTimeoutException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadGatewayException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { eq, and, isNull, lt } from 'drizzle-orm';

import type { TranslateRequest, TranslateResponse } from '@trainslator/shared';

import type { AiUsageEvent } from '@nestjs/ai';
import { AiService } from '@nestjs/ai';

import { DRIZZLE } from '../database/drizzle.module.js';
import type { Database } from '../database/drizzle.module.js';
import { aiMessages, aiMessagePrompts, languages, translations } from '../database/schema.js';

import { Inflight } from '../common/inflight.js';
import { translationKeyFor } from '../common/key.js';
import {
  TRANSLATE_HUMAN_PROMPT,
  buildHumanPrompt,
  buildSystemPrompt,
  stripEnclosingQuotes,
} from './prompts.js';
import type { Env } from '../config/env.js';

/** Result of a translate call; mirrors the shared response contract. */
type TranslateOutcome = TranslateResponse;

/** Whether the error looks like an upstream timeout, walking the cause chain. */
export function isTimeoutError(error: unknown): boolean {
  let current: unknown = error;
  for (let hop = 0; hop < 10; hop += 1) {
    if (!(current instanceof Error)) return false;
    if (
      current.name === 'AbortError' ||
      current.name === 'TimeoutError' ||
      current.name === 'ResilienceTimeoutError' ||
      /timed?\s*out|ETIMEDOUT|TIMEOUT/i.test(current.message)
    ) {
      return true;
    }
    const next = current.cause;
    if (next === undefined || next === current) return false;
    current = next;
  }
  return false;
}

function toUsageRecord(usage: AiUsageEvent['usage']): Record<string, number> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
  };
}

/**
 * The translation pipeline: cache-aside read from `translations`, Ollama call
 * through `@nestjs/ai`, atomic persist of the translation plus the audit rows
 * in one transaction, and single-flight deduplication of identical requests.
 */
@Injectable()
export class TranslateService implements OnModuleInit {
  private readonly logger = new Logger(TranslateService.name);
  private readonly inflight = new Inflight<string, TranslateOutcome>();

  /** Marks stale `processing` audit rows as failed; covers a crash mid-pipeline. Fails soft: a boot without a writable audit table must not take the service down. */
  async onModuleInit(): Promise<void> {
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
        this.logger.warn(`reaped ${rows.length} stale processing AI message(s)`);
      }
    } catch (error) {
      this.logger.error(
        `stale processing reaper skipped: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly ai: AiService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Translates `input.text` into `input.targetLanguage` (ISO 639-1).
   *
   * @param input - validated request body
   * @returns the translation and whether it came from the catalogue cache
   * @throws NotFoundException for an unknown target language
   * @throws BadGatewayException | GatewayTimeoutException when the model fails
   */
  async translate(input: TranslateRequest): Promise<TranslateResponse> {
    const language = await this.findLanguage(input.targetLanguage);
    const key = translationKeyFor(input.text);
    return this.inflight.run(`${language.id}:${key}`, () =>
      this.lockedTranslate(language, key, input.text),
    );
  }

  private async findLanguage(iso: string) {
    const rows = await this.db
      .select({ id: languages.id, iso6391: languages.iso6391, name: languages.name })
      .from(languages)
      .where(and(eq(languages.iso6391, iso), isNull(languages.deletedAt)))
      .limit(1);
    const language = rows[0];
    if (!language) throw new NotFoundException('Unsupported target language');

    return language;
  }

  private async lockedTranslate(
    language: { id: string; iso6391: string; name: string },
    key: string,
    text: string,
  ): Promise<TranslateOutcome> {
    const cached = await this.db
      .select({ text: translations.text })
      .from(translations)
      .where(
        and(
          eq(translations.languageId, language.id),
          eq(translations.key, key),
          isNull(translations.deletedAt),
        ),
      )
      .limit(1);
    if (cached[0]) {
      return { text: cached[0].text, cached: true };
    }

    const model = this.config.get('OLLAMA_TEXT_MODEL', { infer: true });
    const inserted = await this.db
      .insert(aiMessages)
      .values({ provider: 'ollama', model, status: 'processing' })
      .returning({ id: aiMessages.id });
    const message = inserted[0];
    if (!message) throw new Error('ai_messages insert returned no row');

    const prompt = buildHumanPrompt(TRANSLATE_HUMAN_PROMPT, {
      TARGET_LANGUAGE: language.name,
      TEXT: text,
    });

    try {
      const output = await this.ai.generateText({
        model: 'default',
        label: 'translate',
        instructions: buildSystemPrompt(language.name),
        prompt,
        maxOutputTokens: 4096,
      });

      const content = stripEnclosingQuotes(output.text);
      if (!content) {
        throw new Error('model returned an empty completion');
      }

      // Persist translation + audit rows atomically. When the insert loses a
      // race against a concurrent process, the transaction re-reads the winner
      // and aligns the audit row with the text actually served, so the whole
      // unit commits or rolls back together.
      let persistedText = content;
      await this.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(translations)
          .values({ languageId: language.id, namespace: 'dynamic', key, text: content })
          .onConflictDoNothing()
          .returning({ text: translations.text });
        let finalText = inserted[0]?.text ?? content;
        if (inserted.length === 0) {
          const final = await tx
            .select({ text: translations.text })
            .from(translations)
            .where(
              and(
                eq(translations.languageId, language.id),
                eq(translations.key, key),
                isNull(translations.deletedAt),
              ),
            )
            .limit(1);
          finalText = final[0]?.text ?? content;
        }
        await tx.insert(aiMessagePrompts).values([
          { messageId: message.id, role: 'system', prompt: buildSystemPrompt(language.name) },
          { messageId: message.id, role: 'human', prompt },
        ]);
        await tx
          .update(aiMessages)
          .set({
            status: 'completed',
            response: finalText,
            usage: toUsageRecord(output.usage),
            updatedAt: new Date(),
          })
          .where(eq(aiMessages.id, message.id));
        persistedText = finalText;
      });

      return { text: persistedText, cached: false };
    } catch (error) {
      this.logger.error(
        `translation failed for key=${key.slice(0, 12)}… (${isTimeoutError(error) ? 'timeout' : 'upstream'})`,
      );
      await this.db
        .update(aiMessages)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(aiMessages.id, message.id))
        .catch((secondaryError: unknown) => {
          // Best-effort audit; never mask the original failure with a database error.
          this.logger.error(
            `audit row ${message.id} could not be marked failed: ${secondaryError instanceof Error ? secondaryError.name : 'unknown error'}`,
          );
        });

      if (isTimeoutError(error)) {
        throw new GatewayTimeoutException('Translation timed out');
      }
      throw new BadGatewayException('Translation failed');
    }
  }
}
