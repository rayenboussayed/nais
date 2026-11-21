import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiParam, ApiResponse } from '@nestjs/swagger';

import type { TranslationsListQuery } from '../../schemas/list-query.js';
import type { KeysetList } from '../../schemas/list.js';
import type {
  CreateTranslationInput,
  Translation,
  UpdateTranslationBodyInput,
} from '../../schemas/translations.js';

import { translationsListQuerySchema } from '../../schemas/list-query.js';
import { keysetListSchema } from '../../schemas/list.js';
import {
  createTranslationSchema,
  translationSchema,
  updateTranslationBodySchema,
} from '../../schemas/translations.js';
import { ApiErrorResponses } from '../../swagger.js';
import { TranslationsService } from './translations.service.js';

/** REST surface for the translation catalogue. All routes sit behind basic-auth. */
@ApiErrorResponses()
@Controller('translations')
export class TranslationsController {
  constructor(private readonly translationsService: TranslationsService) {}

  /**
   * POST `/api/translations` — create; 409 when (languageId, key) is taken.
   * @param input - the validated create body
   * @returns the created entity
   */
  @ApiResponse({ standardSchema: translationSchema, status: 201 })
  @Post()
  create(
    @Body({ schema: createTranslationSchema }) input: CreateTranslationInput,
  ): Promise<Translation> {
    return this.translationsService.create(input);
  }

  /**
   * GET `/api/translations` — keyset-paginated list with optional filters.
   * @param query - keyset pagination and search filters
   * @returns the keyset-paginated page
   */
  @ApiResponse({ standardSchema: keysetListSchema(translationSchema), status: 200 })
  @Get()
  findAll(
    @Query({ schema: translationsListQuerySchema }) query: TranslationsListQuery,
  ): Promise<KeysetList<Translation>> {
    return this.translationsService.findPage(query);
  }

  /**
   * GET `/api/translations/:id` — one live translation.
   * @param id - the uuid of the requested row
   * @returns the requested row
   */
  @ApiParam({ name: 'id', schema: { format: 'uuid', type: 'string' } })
  @ApiResponse({ standardSchema: translationSchema, status: 200 })
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Translation> {
    return this.translationsService.findOne(id);
  }

  /**
   * DELETE `/api/translations/:id` — soft delete (sets deleted_at).
   * @param id - the uuid of the row to soft-delete
   */
  @ApiParam({ name: 'id', schema: { format: 'uuid', type: 'string' } })
  @ApiResponse({ status: 204 })
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.translationsService.remove(id);
  }

  /**
   * PATCH `/api/translations/:id` — partial update; 400 when nothing changed.
   * @param id - the uuid of the row to update
   * @param input - the validated partial update body
   * @returns the updated row
   */
  @ApiParam({ name: 'id', schema: { format: 'uuid', type: 'string' } })
  @ApiResponse({ standardSchema: translationSchema, status: 200 })
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateTranslationBodySchema }) input: UpdateTranslationBodyInput,
  ): Promise<Translation> {
    return this.translationsService.update(id, input);
  }
}
