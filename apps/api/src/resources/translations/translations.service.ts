import type { SQL } from 'drizzle-orm';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, sql } from 'drizzle-orm';

import type { Database } from '../../db/drizzle.module.js';
import type { TranslationsListQuery } from '../../schemas/list-query.js';
import type { KeysetList } from '../../schemas/list.js';
import type {
  CreateTranslationInput,
  Translation,
  UpdateTranslationBodyInput,
} from '../../schemas/translations.js';

import { DRIZZLE } from '../../db/drizzle.module.js';
import { translations } from '../../db/schema.js';
import { changedFields } from '../../utils/changed-fields.js';
import { isUniqueViolation } from '../../utils/db-error.js';
import { translationKeyFor } from '../../utils/key.js';
import { escapeLike, keysetPage, keysetWhere, timestamptzCursor } from '../../utils/sql.js';

/** Row shape of the translations table; mirrors `translations` in drizzle/schema.ts. */
type TranslationRow = typeof translations.$inferSelect;

/** Translations catalogue and admin CRUD. Dynamic rows carry the sha512 key; static rows a human slug. */
@Injectable()
export class TranslationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Inserts a translation. `static` rows carry the caller's key; `dynamic` rows get the sha512 key.
   * @param input - the validated create body
   * @returns the created translation
   * @throws ConflictException when (languageId, key) is taken; BadRequestException when parentId points at a missing parent
   */
  async create(input: CreateTranslationInput): Promise<Translation> {
    const key = input.namespace === 'dynamic' ? translationKeyFor(input.text) : input.key;
    const parentId = input.namespace === 'static' ? input.parentId : undefined;
    if (parentId) {
      const parent = await this.db
        .select({ id: translations.id })
        .from(translations)
        .where(and(eq(translations.id, parentId), isNull(translations.deletedAt)))
        .limit(1);
      if (parent.length === 0) {
        throw new BadRequestException('Parent translation not found');
      }
    }

    try {
      const rows = await this.db
        .insert(translations)
        .values({
          key,
          languageId: input.languageId,
          namespace: input.namespace,
          parentId: input.namespace === 'static' ? parentId : null,
          text: input.text,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('insert returned no row');
      return rowToTranslation(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Translation with this key already exists for the language');
      }
      throw error;
    }
  }

  /**
   * Cache-aside lookup used by the translate pipeline; a missing row is not an error.
   * @param languageId - catalogue language
   * @param key - sha512-base64url of the source text
   * @returns the row, or null when missing or soft-deleted
   */
  async findByLanguageAndKey(languageId: string, key: string): Promise<null | Translation> {
    const rows = await this.db
      .select()
      .from(translations)
      .where(
        and(
          eq(translations.languageId, languageId),
          eq(translations.key, key),
          isNull(translations.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? rowToTranslation(row) : null;
  }

  /**
   * @param id - uuid of the translation row
   * @returns the translation
   * @throws NotFoundException when missing or soft-deleted
   */
  async findOne(id: string): Promise<Translation> {
    const rows = await this.db
      .select()
      .from(translations)
      .where(and(eq(translations.id, id), isNull(translations.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Translation not found');
    return rowToTranslation(row);
  }

  /**
   * Lists translations with keyset pagination on `(createdAt, id)`.
   * @param params - filters (languageId, namespace), search, cursor and page size
   * @returns the keyset-paginated page
   */
  async findPage(params: TranslationsListQuery): Promise<KeysetList<Translation>> {
    const { languageId, lastCreatedAt, lastId, namespace, onlyDeleted, orderBy, pageSize, q } =
      params;
    const conditions: SQL[] = [
      onlyDeleted ? isNotNull(translations.deletedAt) : isNull(translations.deletedAt),
    ];

    if (languageId) conditions.push(eq(translations.languageId, languageId));
    if (namespace) conditions.push(eq(translations.namespace, namespace));
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        sql`(${translations.key} ilike ${pattern} or ${translations.text} ilike ${pattern})`,
      );
    }

    const cursor = keysetWhere(
      translations.createdAt,
      translations.id,
      orderBy,
      lastCreatedAt,
      lastId,
    );
    if (cursor) conditions.push(cursor);

    const orderColumn =
      orderBy === 'asc' ? asc(translations.createdAt) : desc(translations.createdAt);
    const orderId = orderBy === 'asc' ? asc(translations.id) : desc(translations.id);

    const rows = await this.db
      .select({
        ...getTableColumns(translations),
        createdAtCursor: timestamptzCursor(translations.createdAt),
      })
      .from(translations)
      .where(and(...conditions))
      .orderBy(orderColumn, orderId)
      .limit(pageSize + 1);

    return keysetPage(rows, pageSize, rowToTranslation);
  }

  /**
   * Soft-deletes a translation.
   * @param id - uuid of the translation row
   * @throws NotFoundException when missing or already deleted
   */
  async remove(id: string): Promise<void> {
    const rows = await this.db
      .update(translations)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(translations.id, id), isNull(translations.deletedAt)))
      .returning({ id: translations.id });
    if (rows.length === 0) throw new NotFoundException('Translation not found');
  }

  /**
   * Applies a partial update.
   * @param id - uuid of the translation row
   * @param input - the validated partial update body
   * @returns the updated translation
   * @throws NotFoundException when missing or soft-deleted; BadRequestException when nothing changed; ConflictException on key collision
   */
  async update(id: string, input: UpdateTranslationBodyInput): Promise<Translation> {
    const rows = await this.db
      .select()
      .from(translations)
      .where(and(eq(translations.id, id), isNull(translations.deletedAt)))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundException('Translation not found');

    const changed = changedFields(
      {
        key: before.key,
        languageId: before.languageId,
        namespace: before.namespace,
        parentId: before.parentId,
        text: before.text,
      },
      { ...input },
    );
    if (Object.keys(changed).length === 0) throw new BadRequestException('Nothing changed');

    try {
      const updated = await this.db
        .update(translations)
        .set({ ...changed, updatedAt: new Date() })
        .where(and(eq(translations.id, id), isNull(translations.deletedAt)))
        .returning();
      const row = updated[0];
      // 0 rows: the row was soft-deleted between the read above and this write.
      if (!row) throw new NotFoundException('Translation not found');
      return rowToTranslation(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Translation with this key already exists for the language');
      }
      throw error;
    }
  }
}

/**
 * Maps a drizzle row to the API wire shape.
 * @param row - the drizzle row
 * @returns the API wire shape
 */
function rowToTranslation(row: TranslationRow): Translation {
  return {
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    id: row.id,
    key: row.key,
    languageId: row.languageId,
    namespace: row.namespace,
    parentId: row.parentId,
    text: row.text,
    updatedAt: row.updatedAt.toISOString(),
  };
}
