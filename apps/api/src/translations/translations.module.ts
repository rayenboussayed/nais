import { Module } from '@nestjs/common';

import { TranslationsController } from './translations.controller';
import { TranslationsService } from './translations.service';

/** Translation catalogue: REST CRUD + keyset pagination. */
@Module({
  controllers: [TranslationsController],
  providers: [TranslationsService],
  exports: [TranslationsService],
})
export class TranslationsModule {}
