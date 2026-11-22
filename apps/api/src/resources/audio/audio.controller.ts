import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import type { SttRequest, SttResponse } from '../../schemas/audio.js';

import { sttRequestSchema, sttResponseSchema } from '../../schemas/audio.js';
import { ApiErrorResponses } from '../../swagger.js';
import { ApiResponseSchema } from '../../utils/response-schema.js';
import { SttService } from './stt.service.js';

/**
 * Speech-to-text endpoint at POST `/api/audio/stt`.
 *
 * The base64 JSON body is validated with the shared zod contract, decoded to
 * bytes and handed to the Whisper-backed service. Errors use the shared envelope.
 */
@ApiErrorResponses()
@Controller('audio')
export class AudioController {
  constructor(private readonly sttService: SttService) {}

  /**
   * POST `/api/audio/stt`.
   *
   * Decodes the base64 audio payload and transcribes it, optionally pinning a language.
   * @param body - validated base64 audio with an optional ISO 639-1 language selector
   * @returns the joined transcript, timed segments and the device that produced them
   */
  @ApiResponseSchema(sttResponseSchema, HttpStatus.OK)
  @HttpCode(HttpStatus.OK)
  @Post('stt')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async stt(@Body({ schema: sttRequestSchema }) body: SttRequest): Promise<SttResponse> {
    const audio = Buffer.from(body.audio, 'base64');
    return this.sttService.transcribe(audio, body.language);
  }
}
