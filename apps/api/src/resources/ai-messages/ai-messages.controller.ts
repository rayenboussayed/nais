import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiParam, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';

import type { AiMessage, AiMessagePrompt } from '../../schemas/ai-messages.js';
import type { Pagination } from '../../schemas/common.js';
import type { KeysetList } from '../../schemas/list.js';

import { aiMessagePromptSchema, aiMessageSchema } from '../../schemas/ai-messages.js';
import { paginationSchema } from '../../schemas/common.js';
import { keysetListSchema } from '../../schemas/list.js';
import { ApiErrorResponses } from '../../swagger.js';
import { AiMessagesService } from './ai-messages.service.js';

/** Read-only audit surface for AI provider calls. All routes sit behind basic-auth. */
@ApiErrorResponses()
@Controller('ai-messages')
export class AiMessagesController {
  constructor(private readonly aiMessagesService: AiMessagesService) {}

  /**
   * GET `/api/ai-messages` — keyset-paginated list with optional search.
   * @param query - keyset pagination and search filters
   * @returns the keyset-paginated page of messages
   */
  @ApiResponse({ standardSchema: keysetListSchema(aiMessageSchema), status: 200 })
  @Get()
  findAll(@Query({ schema: paginationSchema }) query: Pagination): Promise<KeysetList<AiMessage>> {
    return this.aiMessagesService.findPage(query);
  }

  /**
   * GET `/api/ai-messages/:id` — one audit row.
   * @param id - uuid of the message row
   * @returns the message
   */
  @ApiParam({ name: 'id', schema: { format: 'uuid', type: 'string' } })
  @ApiResponse({ standardSchema: aiMessageSchema, status: 200 })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<AiMessage> {
    return this.aiMessagesService.findOne(id);
  }

  /**
   * GET `/api/ai-messages/:id/prompts` — prompts captured for the message, oldest first.
   * @param id - uuid of the owning message
   * @returns the prompts oldest first
   */
  @ApiParam({ name: 'id', schema: { format: 'uuid', type: 'string' } })
  @ApiResponse({ standardSchema: z.array(aiMessagePromptSchema), status: 200 })
  @Get(':id/prompts')
  findPrompts(@Param('id', ParseUUIDPipe) id: string): Promise<AiMessagePrompt[]> {
    return this.aiMessagesService.findPrompts(id);
  }

  /**
   * DELETE `/api/ai-messages/:id` — soft delete (sets deleted_at).
   * @param id - uuid of the message row
   */
  @ApiParam({ name: 'id', schema: { format: 'uuid', type: 'string' } })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.aiMessagesService.remove(id);
  }
}
