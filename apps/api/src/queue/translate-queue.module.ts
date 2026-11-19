import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule } from '@nestjs/config';
import { PgBossModule } from '@wavezync/nestjs-pgboss';

import type { Env } from '../config/env';
import { LanguagesModule } from '../languages/languages.module';
import { TranslationsModule } from '../translations/translations.module';
import { TranslateModule } from '../translate/translate.module';
import { TranslateWorker } from './translate.worker';
import { TranslateGateway } from '../ws/translate.gateway';

/**
 * Async translation plumbing: the socket.io gateway clients talk to and the
 * pg-boss worker executing their jobs. pg-boss keeps its own schema
 * (`pgboss`); the Drizzle pool and the boss connection are separate.
 */
@Module({
  imports: [
    ConfigModule,
    TranslateModule,
    LanguagesModule,
    TranslationsModule,
    PgBossModule.forRootAsync({
      // pg-boss gets its own connection via the env transform (PG_BOSS_URL defaults to DATABASE_URL there).
      useFactory: (config: ConfigService<Env, true>) => ({
        connectionString: config.get('PG_BOSS_URL', { infer: true }),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [TranslateGateway, TranslateWorker],
  exports: [TranslateGateway],
})
export class TranslateQueueModule {}
