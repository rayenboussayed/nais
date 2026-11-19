import { Module } from '@nestjs/common';

import { TranslationsController } from './translations.controller.js';
import { TranslationsService } from './translations.service.js';

/** Translation catalogue: REST CRUD + keyset pagination. */
@Module({
  controllers: [TranslationsController],
  exports: [TranslationsService],
  providers: [TranslationsService],
})
export class TranslationsModule {}
