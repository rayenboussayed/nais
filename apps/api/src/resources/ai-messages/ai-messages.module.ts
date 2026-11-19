import { Module } from '@nestjs/common';

import { AiMessagesController } from './ai-messages.controller.js';
import { AiMessagesService } from './ai-messages.service.js';

/** AI provider call audit: read-only REST plus soft delete. */
@Module({
  controllers: [AiMessagesController],
  exports: [AiMessagesService],
  providers: [AiMessagesService],
})
export class AiMessagesModule {}
