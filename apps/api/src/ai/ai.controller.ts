import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type {
  AiFeatureExtractionResult,
  AiQuestionAnsweringResult,
  AiSentimentResult,
  AiSummarizeResult,
  AiTaskDescriptor,
  AiTokenClassificationResult,
  AiZeroShotClassificationResult,
  TranslateResponse,
} from '@trainslator/shared';
import {
  aiSentimentRequestSchema,
  aiSummarizeRequestSchema,
  aiQuestionAnsweringRequestSchema,
  aiFeatureExtractionRequestSchema,
  aiTokenClassificationRequestSchema,
  aiZeroShotClassificationRequestSchema,
  aiTranslateRequestSchema,
  aiSentimentResultSchema,
  aiSummarizeResultSchema,
  aiQuestionAnsweringResultSchema,
  aiTokenClassificationResultSchema,
  aiZeroShotClassificationResultSchema,
  aiFeatureExtractionResultSchema,
  aiTaskDescriptorSchema,
} from '@trainslator/shared';

import { AiService } from './ai.service';

const MODEL_THROTTLE = { default: { limit: 10, ttl: 60_000 } } as const;

/**
 * General-purpose AI endpoints. Each task route validates input against the
 * shared zod contract (native Standard Schema) and returns the shared result
 * shape with `cached`. `GET /api/ai/tasks` lists the registry.
 */
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** GET `/api/ai/tasks` — the registry of supported tasks, their providers and models. */
  @Get('tasks')
  tasks(): { items: AiTaskDescriptor[] } {
    return { items: this.ai.listTasks().map((entry) => aiTaskDescriptorSchema.parse(entry)) };
  }

  /** POST `/api/ai/translate` — same behaviour as `POST /api/translate`, via the general pipeline. */
  @Post('translate')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async translate(
    @Body({ schema: aiTranslateRequestSchema }) body: { text: string; targetLanguage: string },
  ): Promise<TranslateResponse> {
    const envelope = await this.ai.run('translate', body);
    return { text: String(envelope.result.text ?? ''), cached: envelope.cached };
  }

  /** POST `/api/ai/sentiment`. */
  @Post('sentiment')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async sentiment(
    @Body({ schema: aiSentimentRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiSentimentResult> {
    const envelope = await this.ai.run('sentiment', body);
    return aiSentimentResultSchema.parse(envelope.result);
  }

  /** POST `/api/ai/summarize`. */
  @Post('summarize')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async summarize(
    @Body({ schema: aiSummarizeRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiSummarizeResult> {
    const envelope = await this.ai.run('summarize', body);
    return aiSummarizeResultSchema.parse(envelope.result);
  }

  /** POST `/api/ai/question-answering`. */
  @Post('question-answering')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async questionAnswering(
    @Body({ schema: aiQuestionAnsweringRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiQuestionAnsweringResult> {
    const envelope = await this.ai.run('question-answering', body);
    return aiQuestionAnsweringResultSchema.parse(envelope.result);
  }

  /** POST `/api/ai/token-classification`. */
  @Post('token-classification')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async tokenClassification(
    @Body({ schema: aiTokenClassificationRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiTokenClassificationResult> {
    const envelope = await this.ai.run('token-classification', body);
    return aiTokenClassificationResultSchema.parse(envelope.result);
  }

  /** POST `/api/ai/zero-shot-classification`. */
  @Post('zero-shot-classification')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async zeroShot(
    @Body({ schema: aiZeroShotClassificationRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiZeroShotClassificationResult> {
    const envelope = await this.ai.run('zero-shot-classification', body);
    return aiZeroShotClassificationResultSchema.parse(envelope.result);
  }

  /** POST `/api/ai/feature-extraction`. */
  @Post('feature-extraction')
  @Throttle(MODEL_THROTTLE)
  @HttpCode(HttpStatus.OK)
  async featureExtraction(
    @Body({ schema: aiFeatureExtractionRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiFeatureExtractionResult> {
    const envelope = await this.ai.run('feature-extraction', body);
    return aiFeatureExtractionResultSchema.parse(envelope.result);
  }
}
