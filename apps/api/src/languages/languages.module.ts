import { Module } from '@nestjs/common';

import { LanguagesController } from './languages.controller';
import { LanguagesService } from './languages.service';

/** Language catalogue: REST CRUD + keyset pagination. */
@Module({
  controllers: [LanguagesController],
  providers: [LanguagesService],
  exports: [LanguagesService],
})
export class LanguagesModule {}
