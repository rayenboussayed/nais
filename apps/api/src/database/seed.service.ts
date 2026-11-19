import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../config/env.js';
import type { Database } from './drizzle.module.js';

import { DRIZZLE } from './drizzle.module.js';
import { seedLanguages } from './seed.js';

/**
 * Boots the language catalogue into the database on application start.
 * Skipped under `NODE_ENV=test` so suites don't depend on a live database;
 * failures are fatal everywhere else (the service is unusable without it).
 */
@Injectable()
export class LanguageSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(LanguageSeedService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') {
      this.logger.debug('language seed skipped under NODE_ENV=test');
      return;
    }
    const { upserted } = await seedLanguages(this.db);
    this.logger.log(`languages seed complete: ${upserted} rows upserted`);
  }
}
