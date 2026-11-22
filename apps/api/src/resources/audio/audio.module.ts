import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../../environment.js';

import { AudioController } from './audio.controller.js';
import { SttService } from './stt.service.js';

/**
 * Speech-to-text module exposing POST `/api/audio/stt` with the Whisper-backed
 * transcription service. ConfigService is provided globally by ConfigModule.
 */
@Module({
  controllers: [AudioController],
  providers: [
    {
      inject: [ConfigService],
      provide: SttService,
      useFactory: (config: ConfigService<Env, true>) => new SttService(config),
    },
  ],
})
export class AudioModule {}
