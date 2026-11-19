import { Module } from '@nestjs/common';

import { LanguagesController } from './languages.controller.js';
import { LanguagesService } from './languages.service.js';

/** Language catalogue: REST CRUD + keyset pagination. */
@Module({
  controllers: [LanguagesController],
  exports: [LanguagesService],
  providers: [LanguagesService],
})
export class LanguagesModule {}
