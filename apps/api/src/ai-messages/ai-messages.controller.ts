import type { AiMessage, AiMessagePrompt, KeysetList, Pagination } from '@trainslator/shared';

import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { paginationSchema } from '@trainslator/shared';

import { AiMessagesService } from './ai-messages.service.js';

/** Read-only audit surface for AI provider calls. All routes sit behind basic-auth. */
@Controller('ai-messages')
export class AiMessagesController {
  constructor(private readonly aiMessagesService: AiMessagesService) {}

  /**
   * GET `/api/ai-messages` — keyset-paginated list with optional search.
   * @param query - keyset pagination and search filters
   * @returns the keyset-paginated page of messages
   */
  @Get()
  findAll(@Query({ schema: paginationSchema }) query: Pagination): Promise<KeysetList<AiMessage>> {
    return this.aiMessagesService.findPage(query);
  }

  /**
   * GET `/api/ai-messages/:id` — one audit row.
   * @param id - uuid of the message row
   * @returns the message
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AiMessage> {
    return this.aiMessagesService.findOne(id);
  }

  /**
   * GET `/api/ai-messages/:id/prompts` — prompts captured for the message, oldest first.
   * @param id - uuid of the owning message
   * @returns the prompts oldest first
   */
  @Get(':id/prompts')
  findPrompts(@Param('id', ParseUUIDPipe) id: string): Promise<AiMessagePrompt[]> {
    return this.aiMessagesService.findPrompts(id);
  }

  /**
   * DELETE `/api/ai-messages/:id` — soft delete (sets deleted_at).
   * @param id - uuid of the message row
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.aiMessagesService.remove(id);
  }
}
