import { Body, Controller, Post } from '@nestjs/common';
import { Resilience } from '@nestjs/resilience';
import { ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { TranslateRequest, TranslateResponse } from '../../schemas/translations.js';

import { translateRequestSchema, translateResponseSchema } from '../../schemas/translations.js';
import { ApiErrorResponses } from '../../swagger.js';
import { TranslateService } from './translate.service.js';

/** POST `/api/translate` — synchronous translation with cache-aside lookup. */
@ApiErrorResponses()
@Controller('translate')
export class TranslateController {
  constructor(private readonly translateService: TranslateService) {}

  /**
   * POST `/api/translate`
   *
   * Returns the translation immediately when it exists in the catalogue,
   * otherwise calls the configured model, persists the result and returns it.
   * The `ollama` resilience preset caps concurrent model calls and fails
   * fast with 503 when Ollama is down.
   * @param input - the validated translate request body
   * @returns the translation response
   */
  @ApiResponse({ standardSchema: translateResponseSchema, status: 201 })
  @Post()
  @Resilience('ollama')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  translate(
    @Body({ schema: translateRequestSchema }) input: TranslateRequest,
  ): Promise<TranslateResponse> {
    return this.translateService.translate(input);
  }
}
