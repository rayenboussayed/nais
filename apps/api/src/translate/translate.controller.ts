import { Body, Controller, Post } from '@nestjs/common';
import { Resilience } from '@nestjs/resilience';

import type { TranslateRequest, TranslateResponse } from '@trainslator/shared';
import { translateRequestSchema } from '@trainslator/shared';

import { TranslateService } from './translate.service';

/** POST `/api/translate` — synchronous translation with cache-aside lookup. */
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
   */
  @Post()
  @Resilience('ollama')
  translate(
    @Body({ schema: translateRequestSchema }) input: TranslateRequest,
  ): Promise<TranslateResponse> {
    return this.translateService.translate(input);
  }
}
