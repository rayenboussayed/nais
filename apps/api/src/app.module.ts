import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env.js';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module.js';
import type { Env } from './config/env.js';
import { AiMessagesModule } from './ai-messages/ai-messages.module.js';
import { HttpAuthGuard } from './http/auth.guard.js';
import { LanguagesModule } from './languages/languages.module.js';
import { TranslationsModule } from './translations/translations.module.js';
import { TranslateModule } from './translate/translate.module.js';
import { skipHealthProbe } from './config/throttle.js';
import { AiTaskQueueModule } from './queue/ai-task-queue.module.js';
import { AiModule } from './ai/ai.module.js';
import { DrizzleModule } from './database/drizzle.module.js';
import { SeedModule } from './database/seed.module.js';
import { HealthModule } from './health/health.module.js';
import { AllExceptionsFilter } from './http/all-exceptions.filter.js';

/** Root module; boot wiring only, feature modules import here as they land. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),
    DrizzleModule,
    SeedModule,
    HealthModule,
    LanguagesModule,
    AiMessagesModule,
    TranslationsModule,
    TranslateModule,
    AiTaskQueueModule,
    AiModule,
    AuthModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      // /api/health is excluded from the shared quota: orchestrators probe it.
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [{ limit: config.get('THROTTLE_LIMIT', { infer: true }), ttl: 60_000 }],
        skipIf: skipHealthProbe,
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
