import type {
  CreateLanguageInput,
  KeysetList,
  Language,
  Pagination,
  UpdateLanguageBodyInput,
} from '@trainslator/shared';
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

import { DRIZZLE } from '../../db/drizzle.module.js';
import { languages } from '../../db/schema.js';
import { changedFields } from '../../utils/changed-fields.js';
import { isUniqueViolation } from '../../utils/db-error.js';
import { escapeLike, keysetPage, keysetWhere, timestamptzCursor } from '../../utils/sql.js';

/** Row shape of the languages table; mirrors `languages` in drizzle/schema.ts. */
type LanguageRow = typeof languages.$inferSelect;

/** Language catalogue and admin CRUD; iso639_1 is enforced unique by the database. */
@Injectable()
export class LanguagesService {
  /**
   * Bumped on every successful write so an in-flight `findByIso` SELECT that
   * resolves after the write cannot repopulate the cache with a stale snapshot.
   */
  private cacheGeneration = 0;

  /** Process-local cache of ISO 639-1 code to wire row, populated by `findByIso`. */
  private readonly isoCache = new Map<string, Language>();

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Inserts a language.
   * @param input - the validated create body
   * @returns the created language
   * @throws ConflictException when the iso639_1 code is already present
   */
  async create(input: CreateLanguageInput): Promise<Language> {
    try {
      const rows = await this.db
        .insert(languages)
        .values({
          dir: input.dir,
          iso6391: input.iso6391,
          isSource: input.isSource,
          name: input.name,
          nativeName: input.nativeName,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('insert returned no row');
      const language = rowToLanguage(row);
      // Clear any entry for the inserted iso so a committed row is never
      // hidden by stale cached state.
      this.isoCache.delete(language.iso6391);
      this.cacheGeneration += 1;
      return language;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Language with this ISO 639-1 code already exists');
      }
      throw error;
    }
  }

  /**
   * @param iso6391 - one of the seeded ISO 639-1 codes
   * @returns the language row or null when missing/soft-deleted
   */
  async findByIso(iso6391: string): Promise<Language | null> {
    const cached = this.isoCache.get(iso6391);
    if (cached) return cached;

    // Capture before the await: a write that lands while the SELECT is open
    // bumps the generation and forbids this snapshot from entering the cache.
    const generation = this.cacheGeneration;
    const rows = await this.db
      .select()
      .from(languages)
      .where(and(eq(languages.iso6391, iso6391), isNull(languages.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    const language = rowToLanguage(row);
    if (this.cacheGeneration === generation) this.isoCache.set(iso6391, language);
    return language;
  }

  /**
   * @param id - uuid of the language row
   * @returns the language
   * @throws NotFoundException when missing or soft-deleted
   */
  async findOne(id: string): Promise<Language> {
    const rows = await this.db
      .select()
      .from(languages)
      .where(and(eq(languages.id, id), isNull(languages.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('Language not found');
    return rowToLanguage(row);
  }

  /**
   * Lists languages with keyset pagination on `(createdAt, id)`.
   * @param params - pageSize, ordering and cursor from the request query
   * @returns the keyset-paginated page
   */
  async findPage(params: Pagination): Promise<KeysetList<Language>> {
    const { lastCreatedAt, lastId, onlyDeleted, orderBy, pageSize, q } = params;
    const conditions: SQL[] = [
      onlyDeleted ? isNotNull(languages.deletedAt) : isNull(languages.deletedAt),
    ];

    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        sql`(${languages.name} ilike ${pattern} or ${languages.nativeName} ilike ${pattern})`,
      );
    }

    const cursor = keysetWhere(languages.createdAt, languages.id, orderBy, lastCreatedAt, lastId);
    if (cursor) conditions.push(cursor);

    const orderColumn = orderBy === 'asc' ? asc(languages.createdAt) : desc(languages.createdAt);
    const orderId = orderBy === 'asc' ? asc(languages.id) : desc(languages.id);

    const rows = await this.db
      .select({
        ...getTableColumns(languages),
        createdAtCursor: timestamptzCursor(languages.createdAt),
      })
      .from(languages)
      .where(and(...conditions))
      .orderBy(orderColumn, orderId)
      .limit(pageSize + 1);

    return keysetPage(rows, pageSize, rowToLanguage);
  }

  /**
   * Soft-deletes a language.
   * @param id - uuid of the language row
   * @throws NotFoundException when missing or already deleted
   */
  async remove(id: string): Promise<void> {
    const rows = await this.db
      .update(languages)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(languages.id, id), isNull(languages.deletedAt)))
      .returning({ id: languages.id, iso6391: languages.iso6391 });
    const row = rows[0];
    if (!row) throw new NotFoundException('Language not found');
    // The row is no longer visible to findByIso; drop its cached entry.
    this.isoCache.delete(row.iso6391);
    this.cacheGeneration += 1;
  }

  /**
   * Applies a partial update.
   * @param id - uuid of the language row
   * @param input - the validated partial update body
   * @returns the updated language
   * @throws NotFoundException when missing or soft-deleted; BadRequestException when nothing changed
   */
  async update(id: string, input: UpdateLanguageBodyInput): Promise<Language> {
    const rows = await this.db
      .select()
      .from(languages)
      .where(and(eq(languages.id, id), isNull(languages.deletedAt)))
      .limit(1);
    const before = rows[0];
    if (!before) throw new NotFoundException('Language not found');

    const changed = changedFields(
      {
        dir: before.dir,
        iso6391: before.iso6391,
        isSource: before.isSource,
        name: before.name,
        nativeName: before.nativeName,
      },
      { ...input },
    );
    if (Object.keys(changed).length === 0) throw new BadRequestException('Nothing changed');

    try {
      const updated = await this.db
        .update(languages)
        .set({ ...changed, updatedAt: new Date() })
        .where(and(eq(languages.id, id), isNull(languages.deletedAt)))
        .returning();
      const row = updated[0];
      // 0 rows: the row was soft-deleted between the read above and this write.
      if (!row) throw new NotFoundException('Language not found');
      const language = rowToLanguage(row);
      // Invalidate the old iso even when it is unchanged (other fields may have
      // changed), and the new one when the code moved — both entries are stale.
      this.isoCache.delete(before.iso6391);
      this.isoCache.delete(language.iso6391);
      this.cacheGeneration += 1;
      return language;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Language with this ISO 639-1 code already exists');
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
function rowToLanguage(row: LanguageRow): Language {
  return {
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
    dir: row.dir,
    id: row.id,
    iso6391: row.iso6391,
    isSource: row.isSource,
    name: row.name,
    nativeName: row.nativeName,
    updatedAt: row.updatedAt.toISOString(),
  };
}
