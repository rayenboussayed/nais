import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { Database } from '../../db/drizzle.module.js';

import { LanguagesService } from './languages.service.js';

const AT = new Date('2026-01-01T00:00:00.000Z');
const DE = 'de';
const EN = 'en';
const ID = '123e4567-e89b-42d3-a456-426655440000';

const valid = {
  dir: 'ltr',
  iso6391: 'tz',
  isSource: false,
  name: 'Testese',
  nativeName: 'Teste',
} as const;

/** Scripted results and errors handed to the DB double. */
interface StubOptions {
  deferFirstSelect?: boolean;
  insertError?: unknown;
  insertRows?: StubRow[];
  pageRows?: Array<StubRow & { createdAtCursor: string }>;
  selectRows?: StubRow[];
  updateError?: unknown;
  updateRows?: StubRow[];
}

/** Minimal languages row returned by the DB double. */
interface StubRow {
  createdAt: Date;
  deletedAt: Date | null;
  dir: 'ltr' | 'rtl';
  id: string;
  iso6391: string;
  isSource: boolean;
  name: string;
  nativeName: string;
  updatedAt: Date;
}

/**
 * Builds a drizzle-shaped DB double whose results are scripted through mutable
 * state. The double ignores SQL predicates — tests control rows directly — and
 * counts only the `select().from().where().limit()` reads used by findByIso,
 * findOne and update, never the `orderBy()` reads used by findPage.
 * @param options - initial results and errors
 * @returns the Database double and its mutable state
 */
function dbDouble(options: StubOptions = {}) {
  const state = {
    deferNextSelect: options.deferFirstSelect ?? false,
    insertError: options.insertError,
    insertRows: options.insertRows ?? [],
    pageRows: options.pageRows ?? [],
    pendingSelect: null as ((rows: StubRow[]) => void) | null,
    selectCalls: 0,
    selectRows: options.selectRows ?? [],
    updateError: options.updateError,
    updateRows: options.updateRows ?? [],
  };

  const insertReturning = async (): Promise<StubRow[]> => {
    if (state.insertError) throw state.insertError;
    return [...state.insertRows];
  };
  const selectLimit = async (): Promise<StubRow[]> => {
    state.selectCalls += 1;
    if (state.deferNextSelect) {
      state.deferNextSelect = false;
      return new Promise<StubRow[]>((resolve) => {
        state.pendingSelect = resolve;
      });
    }
    return [...state.selectRows];
  };
  const pageLimit = async (): Promise<StubRow[]> => [...state.pageRows];
  const updateReturning = async (): Promise<StubRow[]> => {
    if (state.updateError) throw state.updateError;
    return [...state.updateRows];
  };

  // Cast is confined to this test double: Database is a large generated type.
  const db = {
    insert: () => ({ values: () => ({ returning: insertReturning }) }),
    select: () => {
      const from = () => ({
        where: () => ({ limit: selectLimit, orderBy: () => ({ limit: pageLimit }) }),
      });
      return { from };
    },
    update: () => ({ set: () => ({ where: () => ({ returning: updateReturning }) }) }),
  } as unknown as Database;

  return { db, state };
}

/**
 * Builds a drizzle-shaped row for the stub.
 * @param overrides - fields to override on the default row
 * @returns a row
 */
function makeRow(overrides: Partial<StubRow> = {}): StubRow {
  return {
    createdAt: AT,
    deletedAt: null,
    dir: 'ltr',
    id: ID,
    iso6391: EN,
    isSource: true,
    name: 'English',
    nativeName: 'English',
    updatedAt: AT,
    ...overrides,
  };
}

describe('LanguagesService failure paths (stubbed database)', () => {
  it('create throws when RETURNING yields no row', async () => {
    const { db } = dbDouble();
    await expect(new LanguagesService(db).create(valid)).rejects.toThrow('insert returned no row');
  });

  it('create maps pg unique violations to ConflictException', async () => {
    const { db } = dbDouble({ insertError: { cause: { code: '23505' } } });
    await expect(new LanguagesService(db).create(valid)).rejects.toThrow(/ISO 639-1/);
  });

  it('create rethrows non-unique pg errors', async () => {
    const { db } = dbDouble({ insertError: new Error('boom') });
    await expect(new LanguagesService(db).create(valid)).rejects.toThrow('boom');
  });

  it('update maps pg unique violations to ConflictException', async () => {
    const { db } = dbDouble({
      selectRows: [makeRow()],
      updateError: { cause: { code: '23505' } },
    });
    await expect(new LanguagesService(db).update(ID, { iso6391: DE })).rejects.toThrow(/ISO 639-1/);
  });

  it('update throws when RETURNING yields no row', async () => {
    const { db } = dbDouble({ selectRows: [makeRow()] });
    await expect(new LanguagesService(db).update(ID, { name: 'After' })).rejects.toThrow(
      'Language not found',
    );
  });

  it('update rethrows non-unique pg errors', async () => {
    const { db } = dbDouble({ selectRows: [makeRow()], updateError: new Error('boom') });
    await expect(new LanguagesService(db).update(ID, { name: 'After' })).rejects.toThrow('boom');
  });

  it('update rejects a patch that changes nothing', async () => {
    const { db } = dbDouble({ selectRows: [makeRow()] });
    await expect(new LanguagesService(db).update(ID, { name: 'English' })).rejects.toThrow(
      'Nothing changed',
    );
  });

  it('update throws on an unknown id', async () => {
    const { db } = dbDouble();
    await expect(new LanguagesService(db).update(ID, { name: 'After' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('LanguagesService.findByIso memoization', () => {
  it('returns the cached row without a second query on a hit', async () => {
    const { db, state } = dbDouble({ selectRows: [makeRow()] });
    const service = new LanguagesService(db);

    const first = await service.findByIso(EN);
    const second = await service.findByIso(EN);

    expect(first).toEqual(second);
    expect(first?.iso6391).toBe(EN);
    expect(state.selectCalls).toBe(1);
  });

  it('does not cache a missing language', async () => {
    const { db, state } = dbDouble();
    const service = new LanguagesService(db);

    expect(await service.findByIso('zz')).toBeNull();
    expect(await service.findByIso('zz')).toBeNull();
    expect(state.selectCalls).toBe(2);
  });

  it('create evicts the inserted iso key', async () => {
    const stale = makeRow({ name: 'Stale' });
    const created = makeRow({ name: 'Fresh' });
    // The double ignores the unique constraint, so an insert can reuse an iso
    // that was cached earlier — exactly the stale entry create must evict.
    const { db, state } = dbDouble({
      insertRows: [created],
      selectRows: [stale],
    });
    const service = new LanguagesService(db);
    await service.findByIso(EN);
    const readsBeforeCreate = state.selectCalls;

    expect((await service.create({ ...valid, iso6391: EN })).name).toBe('Fresh');

    state.selectRows = [created];
    expect((await service.findByIso(EN))?.name).toBe('Fresh');
    expect(state.selectCalls).toBe(readsBeforeCreate + 1);
  });

  it('update evicts both the old and the new iso key when the code changes', async () => {
    const before = makeRow({ iso6391: EN, name: 'English' });
    const after = makeRow({ iso6391: DE, name: 'Deutsch' });
    const { db, state } = dbDouble({ selectRows: [before], updateRows: [after] });
    const service = new LanguagesService(db);
    await service.findByIso(EN);
    // Prime the new key too: the double ignores the predicate, so the old row
    // is cached under it. A correct update must evict both keys.
    await service.findByIso(DE);
    const readsBeforeUpdate = state.selectCalls;

    expect((await service.update(ID, { iso6391: DE })).iso6391).toBe(DE);

    // update reads the row once for changedFields; both lookups below then
    // miss because eviction removed each cached key.
    state.selectRows = [after];
    expect((await service.findByIso(EN))?.iso6391).toBe(DE);
    expect((await service.findByIso(DE))?.iso6391).toBe(DE);
    expect(state.selectCalls).toBe(readsBeforeUpdate + 3);
  });

  it('update evicts the iso key when only other fields change', async () => {
    const before = makeRow({ name: 'Before' });
    const after = makeRow({ name: 'After' });
    const { db, state } = dbDouble({ selectRows: [before], updateRows: [after] });
    const service = new LanguagesService(db);
    await service.findByIso(EN);

    await service.update(ID, { name: 'After' });

    state.selectRows = [after];
    expect((await service.findByIso(EN))?.name).toBe('After');
  });

  it('remove evicts the soft-deleted iso key', async () => {
    const row = makeRow();
    const { db, state } = dbDouble({ selectRows: [row], updateRows: [row] });
    const service = new LanguagesService(db);
    await service.findByIso(EN);

    await service.remove(ID);

    state.selectRows = [];
    expect(await service.findByIso(EN)).toBeNull();
  });

  it('remove of an unknown id throws and leaves the cache intact', async () => {
    const { db, state } = dbDouble({ selectRows: [makeRow()] });
    const service = new LanguagesService(db);
    await service.findByIso(EN);
    const readsBeforeRemove = state.selectCalls;

    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);

    state.selectRows = [];
    expect(await service.findByIso(EN)).not.toBeNull();
    expect(state.selectCalls).toBe(readsBeforeRemove);
  });

  it('does not cache a SELECT that resolves after a concurrent update evicts the key', async () => {
    const stale = makeRow({ name: 'Stale' });
    const fresh = makeRow({ name: 'Fresh' });
    const { db, state } = dbDouble({
      deferFirstSelect: true,
      selectRows: [stale],
      updateRows: [fresh],
    });
    const service = new LanguagesService(db);

    // Hold the first lookup's SELECT open until the write has landed.
    const inFlight = service.findByIso(EN);
    expect(state.pendingSelect).not.toBeNull();
    await service.update(ID, { name: 'Fresh' });

    // The stale snapshot still resolves for its own caller, but must not cache.
    state.pendingSelect?.([stale]);
    expect((await inFlight)?.name).toBe('Stale');

    state.selectRows = [fresh];
    expect((await service.findByIso(EN))?.name).toBe('Fresh');
  });

  it('does not cache a SELECT that resolves after a concurrent remove evicts the key', async () => {
    const row = makeRow();
    const { db, state } = dbDouble({
      deferFirstSelect: true,
      selectRows: [row],
      updateRows: [row],
    });
    const service = new LanguagesService(db);

    const inFlight = service.findByIso(EN);
    expect(state.pendingSelect).not.toBeNull();
    await service.remove(ID);

    state.pendingSelect?.([row]);
    expect(await inFlight).not.toBeNull();

    state.selectRows = [];
    expect(await service.findByIso(EN)).toBeNull();
  });
});

describe('LanguagesService reads (stubbed database)', () => {
  it('findOne maps a row including a soft-delete timestamp', async () => {
    const deletedAt = new Date('2026-02-01T00:00:00.000Z');
    const { db } = dbDouble({ selectRows: [makeRow({ deletedAt })] });
    expect((await new LanguagesService(db).findOne(ID)).deletedAt).toBe(deletedAt.toISOString());
  });

  it('findOne throws on an unknown id', async () => {
    const { db } = dbDouble();
    await expect(new LanguagesService(db).findOne('missing')).rejects.toThrow(NotFoundException);
  });

  it('findPage slices the page and returns the next cursor', async () => {
    const rows = [
      {
        createdAtCursor: '2026-01-01T00:00:00.000000+00',
        ...makeRow({ id: 'a' }),
      },
      {
        createdAtCursor: '2026-01-02T00:00:00.000000+00',
        ...makeRow({ id: 'b' }),
      },
    ];
    const { db } = dbDouble({ pageRows: rows });
    const result = await new LanguagesService(db).findPage({
      lastCreatedAt: undefined,
      lastId: undefined,
      onlyDeleted: false,
      orderBy: 'asc',
      pageSize: 1,
      q: 'eng',
    });
    expect(result.items).toHaveLength(1);
    expect(result.next).toEqual({
      lastCreatedAt: '2026-01-01T00:00:00.000000+00',
      lastId: 'a',
    });
  });

  it('findPage handles deleted-only rows with a cursor and descending order', async () => {
    const { db } = dbDouble();
    const result = await new LanguagesService(db).findPage({
      lastCreatedAt: '2026-01-01T00:00:00.000000+00',
      lastId: ID,
      onlyDeleted: true,
      orderBy: 'desc',
      pageSize: 5,
      q: undefined,
    });
    expect(result.items).toEqual([]);
    expect(result.next).toBeNull();
  });
});
