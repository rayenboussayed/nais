import { Module } from '@nestjs/common';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import type { Env } from './environment.js';

import { AllExceptionsFilter } from './app.exception-filter.js';
import { skipHealthProbe } from './configs/throttle.js';
import { DrizzleModule } from './db/drizzle.module.js';
import { SeedModule } from './db/seed.module.js';
import { validateEnv } from './environment.js';
import { HttpAuthGuard } from './guards/auth.guard.js';
import { AiTaskQueueModule } from './modules/queue/ai-task-queue.module.js';
import { TelemetryModule } from './modules/telemetry/telemetry.module.js';
import { AiMessagesModule } from './resources/ai-messages/ai-messages.module.js';
import { AiModule } from './resources/ai/ai.module.js';
import { AudioModule } from './resources/audio/audio.module.js';
import { AuthModule } from './resources/auth/auth.module.js';
import { HealthModule } from './resources/health/health.module.js';
import { LanguagesModule } from './resources/languages/languages.module.js';
import { TranslateModule } from './resources/translate/translate.module.js';
import { TranslationsModule } from './resources/translations/translations.module.js';

/** Root module; boot wiring only, feature modules import here as they land. */
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnv,
    }),
    TelemetryModule,
    DrizzleModule,
    SeedModule,
    HealthModule,
    LanguagesModule,
    AiMessagesModule,
    TranslationsModule,
    TranslateModule,
    AiTaskQueueModule,
    AiModule,
    AudioModule,
    AuthModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      // /api/health is excluded from the shared quota: orchestrators probe it.
      useFactory: (config: ConfigService<Env, true>) => ({
        skipIf: skipHealthProbe,
        throttlers: [{ limit: config.get('THROTTLE_LIMIT', { infer: true }), ttl: 60_000 }],
      }),
    }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    {
      provide: APP_PIPE,
      useValue: new StandardSchemaValidationPipe(),
    },
    // Order matters: throttle before authenticate so unauthorized floods
    // are rejected with 429 before any scrypt work happens.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: HttpAuthGuard,
    },
  ],
})
export class AppModule {}
