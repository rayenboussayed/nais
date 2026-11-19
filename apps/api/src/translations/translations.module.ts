import { Module } from '@nestjs/common';

import { TranslationsController } from './translations.controller.js';
import { TranslationsService } from './translations.service.js';

/** Translation catalogue: REST CRUD + keyset pagination. */
@Module({
  controllers: [TranslationsController],
  providers: [TranslationsService],
  exports: [TranslationsService],
})
export class TranslationsModule {}
