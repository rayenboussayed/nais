import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env';
import { StandardSchemaValidationPipe } from '@nestjs/common';

import { AiMessagesModule } from './ai-messages/ai-messages.module';
import { LanguagesModule } from './languages/languages.module';
import { TranslationsModule } from './translations/translations.module';
import { TranslateModule } from './translate/translate.module';
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
  ],
})
export class AppModule {}
