import { Module } from '@nestjs/common';

import { AiMessagesController } from './ai-messages.controller';
import { AiMessagesService } from './ai-messages.service';

/** AI provider call audit: read-only REST plus soft delete. */
@Module({
  controllers: [AiMessagesController],
  providers: [AiMessagesService],
  exports: [AiMessagesService],
})
export class AiMessagesModule {}
