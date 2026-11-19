import { Module } from '@nestjs/common';

import { LanguageSeedService } from './seed.service.js';

/** Runs the idempotent language seed after the module graph is wired. */
@Module({
  providers: [LanguageSeedService],
})
export class SeedModule {}
