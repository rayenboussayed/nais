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
} from '../../schemas/ai.js';
import type { TranslateResponse } from '../../schemas/translations.js';

import {
  aiFeatureExtractionRequestSchema,
  aiFeatureExtractionResultSchema,
  aiQuestionAnsweringRequestSchema,
  aiQuestionAnsweringResultSchema,
  aiSentimentRequestSchema,
  aiSentimentResultSchema,
  aiSummarizeRequestSchema,
  aiSummarizeResultSchema,
  aiTaskDescriptorSchema,
  aiTaskListResponseSchema,
  aiTokenClassificationRequestSchema,
  aiTokenClassificationResultSchema,
  aiTranslateRequestSchema,
  aiZeroShotClassificationRequestSchema,
  aiZeroShotClassificationResultSchema,
} from '../../schemas/ai.js';
import { translateResponseSchema } from '../../schemas/translations.js';
import { ApiErrorResponses } from '../../swagger.js';
import { ApiResponseSchema } from '../../utils/response-schema.js';
import { AiService } from './ai.service.js';

const MODEL_THROTTLE = { default: { limit: 10, ttl: 60_000 } } as const;

/**
 * General-purpose AI endpoints. Each task route validates input against the
 * shared zod contract (native Standard Schema) and returns the shared result
 * shape with `cached`. `GET /api/ai/tasks` lists the registry.
 */
@ApiErrorResponses()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  /**
   * POST `/api/ai/feature-extraction`.
   * @param body - the validated request body (task input schema)
   * @returns the parsed task result
   */
  @ApiResponseSchema(aiFeatureExtractionResultSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('feature-extraction')
  @Throttle(MODEL_THROTTLE)
  async featureExtraction(
    @Body({ schema: aiFeatureExtractionRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiFeatureExtractionResult> {
    const envelope = await this.ai.run('feature-extraction', body);
    return aiFeatureExtractionResultSchema.parse(envelope.result);
  }

  /**
   * POST `/api/ai/question-answering`.
   * @param body - the validated request body (task input schema)
   * @returns the parsed task result
   */
  @ApiResponseSchema(aiQuestionAnsweringResultSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('question-answering')
  @Throttle(MODEL_THROTTLE)
  async questionAnswering(
    @Body({ schema: aiQuestionAnsweringRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiQuestionAnsweringResult> {
    const envelope = await this.ai.run('question-answering', body);
    return aiQuestionAnsweringResultSchema.parse(envelope.result);
  }

  /**
   * POST `/api/ai/sentiment`.
   * @param body - the validated request body (task input schema)
   * @returns the parsed task result
   */
  @ApiResponseSchema(aiSentimentResultSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('sentiment')
  @Throttle(MODEL_THROTTLE)
  async sentiment(
    @Body({ schema: aiSentimentRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiSentimentResult> {
    const envelope = await this.ai.run('sentiment', body);
    return aiSentimentResultSchema.parse(envelope.result);
  }

  /**
   * POST `/api/ai/summarize`.
   * @param body - the validated request body (task input schema)
   * @returns the parsed task result
   */
  @ApiResponseSchema(aiSummarizeResultSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('summarize')
  @Throttle(MODEL_THROTTLE)
  async summarize(
    @Body({ schema: aiSummarizeRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiSummarizeResult> {
    const envelope = await this.ai.run('summarize', body);
    return aiSummarizeResultSchema.parse(envelope.result);
  }

  /**
   * GET `/api/ai/tasks` — the registry of supported tasks, their providers and models.
   * @returns the parsed task descriptors
   */
  @ApiResponseSchema(aiTaskListResponseSchema, HttpStatus.OK)
  @Get('tasks')
  tasks(): { items: AiTaskDescriptor[] } {
    return { items: this.ai.listTasks().map((entry) => aiTaskDescriptorSchema.parse(entry)) };
  }

  /**
   * POST `/api/ai/token-classification`.
   * @param body - the validated request body (task input schema)
   * @returns the parsed task result
   */
  @ApiResponseSchema(aiTokenClassificationResultSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('token-classification')
  @Throttle(MODEL_THROTTLE)
  async tokenClassification(
    @Body({ schema: aiTokenClassificationRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiTokenClassificationResult> {
    const envelope = await this.ai.run('token-classification', body);
    return aiTokenClassificationResultSchema.parse(envelope.result);
  }

  /**
   * POST `/api/ai/translate` — same behaviour as `POST /api/translate`, via the general pipeline.
   * @param body - the validated request body
   * @param body.text - the source text to translate
   * @param body.targetLanguage - the iso639-1 target language
   * @returns the catalogue-aware translation response
   */
  @ApiResponseSchema(translateResponseSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('translate')
  @Throttle(MODEL_THROTTLE)
  async translate(
    @Body({ schema: aiTranslateRequestSchema }) body: { targetLanguage: string; text: string },
  ): Promise<TranslateResponse> {
    const envelope = await this.ai.run('translate', body);
    return { cached: envelope.cached, text: String(envelope.result.text ?? '') };
  }

  /**
   * POST `/api/ai/zero-shot-classification`.
   * @param body - the validated request body (task input schema)
   * @returns the parsed task result
   */
  @ApiResponseSchema(aiZeroShotClassificationResultSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('zero-shot-classification')
  @Throttle(MODEL_THROTTLE)
  async zeroShot(
    @Body({ schema: aiZeroShotClassificationRequestSchema }) body: Record<string, unknown>,
  ): Promise<AiZeroShotClassificationResult> {
    const envelope = await this.ai.run('zero-shot-classification', body);
    return aiZeroShotClassificationResultSchema.parse(envelope.result);
  }
}
