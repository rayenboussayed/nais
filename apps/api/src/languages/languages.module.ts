import { Module } from '@nestjs/common';

import { LanguagesController } from './languages.controller.js';
import { LanguagesService } from './languages.service.js';

/** Language catalogue: REST CRUD + keyset pagination. */
@Module({
  controllers: [LanguagesController],
  providers: [LanguagesService],
  exports: [LanguagesService],
})
export class LanguagesModule {}
