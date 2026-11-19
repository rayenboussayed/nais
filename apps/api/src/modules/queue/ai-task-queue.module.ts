import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { PgBossModule } from '@wavezync/nestjs-pgboss';

import type { Env } from '../../environment.js';

import { AiModule } from '../../resources/ai/ai.module.js';
import { LanguagesModule } from '../../resources/languages/languages.module.js';
import { TranslateGateway } from '../../resources/translate/translate.gateway.js';
import { TranslationsModule } from '../../resources/translations/translations.module.js';
import { AiTaskWorker } from './ai-task.worker.js';

/**
 * Async AI plumbing: the socket.io gateway clients talk to and the pg-boss
 * worker executing their jobs. pg-boss keeps its own schema (`pgboss`); the
 * Drizzle pool and the boss connection are separate.
 */
@Module({
  exports: [TranslateGateway],
  imports: [
    ConfigModule,
    AiModule,
    LanguagesModule,
    TranslationsModule,
    PgBossModule.forRootAsync({
      inject: [ConfigService],
      // pg-boss gets its own connection via the env transform (PG_BOSS_URL defaults to DATABASE_URL there).
      useFactory: (config: ConfigService<Env, true>) => ({
        connectionString: config.get('PG_BOSS_URL', { infer: true }),
      }),
    }),
  ],
  providers: [TranslateGateway, AiTaskWorker],
})
export class AiTaskQueueModule {}
