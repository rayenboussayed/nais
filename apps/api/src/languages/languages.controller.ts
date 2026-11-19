import type {
  CreateLanguageInput,
  KeysetList,
  Language,
  Pagination,
  UpdateLanguageBodyInput,
} from '@trainslator/shared';

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
import {
  createLanguageSchema,
  paginationSchema,
  updateLanguageBodySchema,
} from '@trainslator/shared';

import { LanguagesService } from './languages.service.js';

/** REST surface for the language catalogue. All routes sit behind basic-auth. */
@Controller('languages')
export class LanguagesController {
  constructor(private readonly languagesService: LanguagesService) {}

  /**
   * POST `/api/languages` — create; 409 when the ISO code is taken.
   * @param input - the validated create body
   * @returns the created entity
   */
  @Post()
  create(@Body({ schema: createLanguageSchema }) input: CreateLanguageInput): Promise<Language> {
    return this.languagesService.create(input);
  }

  /**
   * GET `/api/languages` — keyset-paginated list with optional search.
   * @param query - keyset pagination and search filters
   * @returns the keyset-paginated page
   */
  @Get()
  findAll(@Query({ schema: paginationSchema }) query: Pagination): Promise<KeysetList<Language>> {
    return this.languagesService.findPage(query);
  }

  /**
   * GET `/api/languages/:id` — a single live language.
   * @param id - the uuid of the requested row
   * @returns the requested row
   */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Language> {
    return this.languagesService.findOne(id);
  }

  /**
   * DELETE `/api/languages/:id` — soft delete (sets deleted_at).
   * @param id - the uuid of the row to soft-delete
   */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.languagesService.remove(id);
  }

  /**
   * PATCH `/api/languages/:id` — partial update; 400 when nothing changed.
   * @param id - the uuid of the row to update
   * @param input - the validated partial update body
   * @returns the updated row
   */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateLanguageBodySchema }) input: UpdateLanguageBodyInput,
  ): Promise<Language> {
    return this.languagesService.update(id, input);
  }
}
