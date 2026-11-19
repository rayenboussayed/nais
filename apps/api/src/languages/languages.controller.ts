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
  CreateLanguageInput,
  KeysetList,
  Language,
  Pagination,
  UpdateLanguageBodyInput,
} from '@trainslator/shared';
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

  /** GET `/api/languages` — keyset-paginated list with optional search. */
  @Get()
  findAll(@Query({ schema: paginationSchema }) query: Pagination): Promise<KeysetList<Language>> {
    return this.languagesService.findPage(query);
  }

  /** GET `/api/languages/:id` — a single live language. */
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string): Promise<Language> {
    return this.languagesService.findOne(id);
  }

  /** POST `/api/languages` — create; 409 when the ISO code is taken. */
  @Post()
  create(@Body({ schema: createLanguageSchema }) input: CreateLanguageInput): Promise<Language> {
    return this.languagesService.create(input);
  }

  /** PATCH `/api/languages/:id` — partial update; 400 when nothing changed. */
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body({ schema: updateLanguageBodySchema }) input: UpdateLanguageBodyInput,
  ): Promise<Language> {
    return this.languagesService.update(id, input);
  }

  /** DELETE `/api/languages/:id` — soft delete (sets deleted_at). */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.languagesService.remove(id);
  }
}
