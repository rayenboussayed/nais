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

import type {
  CreateTranslationInput,
  KeysetList,
  Translation,
  UpdateTranslationBodyInput,
} from '@trainslator/shared';
import { createTranslationSchema, updateTranslationBodySchema } from '@trainslator/shared';

import type { TranslationsListQuery } from '../common/list-query';
import { translationsListQuerySchema } from '../common/list-query';

import { TranslationsService } from './translations.service';

/** REST surface for the translation catalogue. All routes sit behind basic-auth. */
@Controller('translations')
export class TranslationsController {
  constructor(private readonly translationsService: TranslationsService) {}

  /** GET `/api/translations` — keyset-paginated list with optional filters. */
  @Get()
  findAll(
    @Query({ schema: translationsListQuerySchema }) query: TranslationsListQuery,
  ): Promise<KeysetList<Translation>> {
    return this.translationsService.findPage(query);
  }

  /** GET `/api/translations/:id` — one live translation. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Translation> {
    return this.translationsService.findOne(id);
  }

  /** POST `/api/translations` — create; 409 when (languageId, key) is taken. */
  @Post()
  create(
    @Body({ schema: createTranslationSchema }) input: CreateTranslationInput,
  ): Promise<Translation> {
    return this.translationsService.create(input);
  }

  /** PATCH `/api/translations/:id` — partial update; 400 when nothing changed. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateTranslationBodySchema }) input: UpdateTranslationBodyInput,
  ): Promise<Translation> {
    return this.translationsService.update(id, input);
  }

  /** DELETE `/api/translations/:id` — soft delete (sets deleted_at). */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.translationsService.remove(id);
  }
}
