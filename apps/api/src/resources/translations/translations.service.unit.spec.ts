import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { Database } from '../../db/drizzle.module.js';

import { translationKeyFor } from '../../utils/key.js';
import { TranslationsService } from './translations.service.js';

const AT = new Date('2026-01-01T00:00:00.000Z');
const ID = '123e4567-e89b-42d3-a456-426655440000';
const LANG = '323e4567-e89b-42d3-a456-426655440000';
const PARENT = '223e4567-e89b-42d3-a456-426655440000';

/** Scripted results and captured writes for the DB double. */
interface StubOptions {
  insertError?: unknown;
  insertRows?: StubRow[];
  pageRows?: Array<StubRow & { createdAtCursor: string }>;
  selectResults?: StubRow[][];
  updateError?: unknown;
  updateRows?: StubRow[];
}

/** Minimal translation row handed to the double; predicates are ignored. */
type StubRow = Record<string, unknown>;

/**
 * Builds a drizzle-shaped DB double: plain selects drain a queue, paged selects
 * use a fixed set, and insert/update writes are captured for assertions.
 * @param options - scripted results and errors
 * @returns the Database double and the captured write payloads
 */
function dbDouble(options: StubOptions = {}) {
  const insertValues: StubRow[] = [];
  const updateSets: StubRow[] = [];
  const selectQueue = [...(options.selectResults ?? [])];

  const selectLimit = async (): Promise<StubRow[]> => selectQueue.shift() ?? [];
  const pageLimit = async (): Promise<Array<StubRow & { createdAtCursor: string }>> => [
    ...(options.pageRows ?? []),
  ];

  // Cast is confined to this test double: Database is a large generated type.
  const db = {
    insert: () => ({
      values: (value: StubRow) => {
        insertValues.push(value);
        return {
          returning: async () => {
            if (options.insertError) throw options.insertError;
            return [...(options.insertRows ?? [])];
          },
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: selectLimit,
          orderBy: () => ({ limit: pageLimit }),
        }),
      }),
    }),
    update: () => ({
      set: (value: StubRow) => {
        updateSets.push(value);
        return {
          where: () => ({
            returning: async () => {
              if (options.updateError) throw options.updateError;
              return [...(options.updateRows ?? [])];
            },
          }),
        };
      },
    }),
  } as unknown as Database;

  return { db, insertValues, updateSets };
}

/**
 * Builds a full translation row for the stub, overridable per test.
 * @param overrides - fields to replace on the default row
 * @returns a row
 */
function makeRow(overrides: StubRow = {}): StubRow {
  return {
    createdAt: AT,
    deletedAt: null,
    id: ID,
    key: 'greeting',
    languageId: LANG,
    namespace: 'static',
    parentId: null,
    text: 'bonjour',
    updatedAt: AT,
    ...overrides,
  };
}

describe('TranslationsService create (stubbed database)', () => {
  it('derives a sha512 key for dynamic rows and never stores a caller key', async () => {
    const key = translationKeyFor('hello');
    const { db, insertValues } = dbDouble({
      insertRows: [makeRow({ key, namespace: 'dynamic', text: 'hello' })],
    });

    const result = await new TranslationsService(db).create({
      languageId: LANG,
      namespace: 'dynamic',
      text: 'hello',
    });

    expect(insertValues[0]).toMatchObject({
      key,
      languageId: LANG,
      namespace: 'dynamic',
      parentId: null,
      text: 'hello',
    });
    expect(result.key).toBe(key);
  });

  it('keeps the caller key and attaches a validated parent for static rows', async () => {
    const { db, insertValues } = dbDouble({
      insertRows: [makeRow({ parentId: PARENT })],
      selectResults: [[{ id: PARENT }]],
    });

    const result = await new TranslationsService(db).create({
      key: 'greeting',
      languageId: LANG,
      namespace: 'static',
      parentId: PARENT,
      text: 'bonjour',
    });

    expect(insertValues[0]).toMatchObject({ key: 'greeting', parentId: PARENT });
    expect(result.parentId).toBe(PARENT);
  });

  it('rejects a static row whose parent is missing without inserting', async () => {
    const { db, insertValues } = dbDouble({ selectResults: [[]] });

    await expect(
      new TranslationsService(db).create({
        key: 'greeting',
        languageId: LANG,
        namespace: 'static',
        parentId: PARENT,
        text: 'bonjour',
      }),
    ).rejects.toThrow('Parent translation not found');
    expect(insertValues).toHaveLength(0);
  });

  it('creates a parentless static row without a parent lookup', async () => {
    const { db, insertValues } = dbDouble({ insertRows: [makeRow()] });

    const result = await new TranslationsService(db).create({
      key: 'greeting',
      languageId: LANG,
      namespace: 'static',
      text: 'bonjour',
    });

    expect(insertValues[0]).toMatchObject({ key: 'greeting', namespace: 'static' });
    expect(result.key).toBe('greeting');
  });
});

describe('TranslationsService reads (stubbed database)', () => {
  it('findByLanguageAndKey maps a hit and returns null for a miss', async () => {
    const key = translationKeyFor('hello');
    const { db } = dbDouble({ selectResults: [[makeRow({ key })], []] });
    const service = new TranslationsService(db);

    const hit = await service.findByLanguageAndKey(LANG, key);
    expect(hit).toMatchObject({ deletedAt: null, id: ID, key, text: 'bonjour' });
    expect(hit?.createdAt).toBe(AT.toISOString());
    expect(await service.findByLanguageAndKey(LANG, 'missing')).toBeNull();
  });

  it('findOne maps a soft-deleted row and throws for an unknown id', async () => {
    const deletedAt = new Date('2026-02-01T00:00:00.000Z');
    const { db } = dbDouble({ selectResults: [[makeRow({ deletedAt })], []] });
    const service = new TranslationsService(db);

    expect((await service.findOne(ID)).deletedAt).toBe(deletedAt.toISOString());
    await expect(service.findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('findPage slices the page and returns a microsecond cursor with all filters applied', async () => {
    const rows = [
      { createdAtCursor: '2026-01-01T00:00:00.000000+00', ...makeRow({ id: 'a' }) },
      { createdAtCursor: '2026-01-02T00:00:00.000000+00', ...makeRow({ id: 'b' }) },
    ];
    const { db } = dbDouble({ pageRows: rows });

    const result = await new TranslationsService(db).findPage({
      languageId: LANG,
      lastCreatedAt: '2026-01-01T00:00:00.000000+00',
      lastId: 'a',
      namespace: 'static',
      onlyDeleted: true,
      orderBy: 'desc',
      pageSize: 1,
      q: 'bonjour',
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe('a');
    expect(result.next).toEqual({
      lastCreatedAt: '2026-01-01T00:00:00.000000+00',
      lastId: 'a',
    });
  });

  it('findPage returns no next cursor on the final page with no filters', async () => {
    const { db } = dbDouble({ pageRows: [] });

    const result = await new TranslationsService(db).findPage({
      languageId: undefined,
      lastCreatedAt: undefined,
      lastId: undefined,
      namespace: undefined,
      onlyDeleted: false,
      orderBy: 'asc',
      pageSize: 5,
      q: undefined,
    });

    expect(result).toEqual({ items: [], next: null });
  });
});

describe('TranslationsService writes (stubbed database)', () => {
  it('remove soft-deletes a live row with fresh timestamps', async () => {
    const { db, updateSets } = dbDouble({ updateRows: [{ id: ID }] });

    await expect(new TranslationsService(db).remove(ID)).resolves.toBeUndefined();
    expect(updateSets[0]).toEqual({
      deletedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
  });

  it('remove throws when nothing was soft-deleted', async () => {
    const { db } = dbDouble();

    await expect(new TranslationsService(db).remove('missing')).rejects.toThrow(
      'Translation not found',
    );
  });

  it('update applies only changed fields and maps the updated row', async () => {
    const { db, updateSets } = dbDouble({
      selectResults: [[makeRow({ text: 'before' })]],
      updateRows: [makeRow({ text: 'after' })],
    });

    const result = await new TranslationsService(db).update(ID, { text: 'after' });

    expect(result.text).toBe('after');
    expect(updateSets[0]).toEqual({ text: 'after', updatedAt: expect.any(Date) });
  });

  it('update rejects a patch that changes nothing without writing', async () => {
    const { db, updateSets } = dbDouble({ selectResults: [[makeRow()]] });

    await expect(new TranslationsService(db).update(ID, { text: 'bonjour' })).rejects.toThrow(
      'Nothing changed',
    );
    expect(updateSets).toHaveLength(0);
  });

  it('update throws NotFound for an unknown id', async () => {
    const { db } = dbDouble({ selectResults: [[]] });

    await expect(new TranslationsService(db).update(ID, { text: 'after' })).rejects.toThrow(
      NotFoundException,
    );
  });
});
