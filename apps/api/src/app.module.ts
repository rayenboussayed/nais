import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AuthModule } from './auth/auth.module';
import type { Env } from './config/env';
import { AiMessagesModule } from './ai-messages/ai-messages.module';
import { HttpAuthGuard } from './http/auth.guard';
import { LanguagesModule } from './languages/languages.module';
import { TranslationsModule } from './translations/translations.module';
import { TranslateModule } from './translate/translate.module';
import { skipHealthProbe } from './config/throttle';
import { TranslateQueueModule } from './queue/translate-queue.module';
import { DrizzleModule } from './database/drizzle.module';
import { SeedModule } from './database/seed.module';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './http/all-exceptions.filter';

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
    TranslateQueueModule,
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
