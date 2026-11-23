import type { SQL } from 'drizzle-orm';

import { eq } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { languages } from '../db/schema.js';
import {
  buildListConditions,
  escapeLike,
  keysetPage,
  keysetWhere,
  orderByColumns,
  timestamptzCursor,
} from './sql.js';

const dialect = new PgDialect();
const render = (fragment: SQL): string => dialect.sqlToQuery(fragment).sql;

describe('escapeLike', () => {
  it('escapes %, _ and backslash itself', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('_')).toBe('\\_');
    expect(escapeLike('\\')).toBe('\\\\');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLike('arabic')).toBe('arabic');
  });

  it('escapes in the right order (backslash first)', () => {
    expect(escapeLike('a\\%b')).toBe('a\\\\\\%b');
  });
});

describe('timestamptzCursor', () => {
  it('builds a cursor expression for the column', () => {
    expect(timestamptzCursor(languages.createdAt)).toBeDefined();
  });
});

describe('keysetWhere', () => {
  const column = languages.createdAt;
  const id = languages.id;

  it('returns undefined without any cursor and throws on a partial cursor', () => {
    expect(keysetWhere(column, id, 'desc', undefined, undefined)).toBeUndefined();
    expect(() =>
      keysetWhere(column, id, 'desc', '2026-11-18T00:00:00.000000+00:00', undefined),
    ).toThrow(/both lastCreatedAt and lastId/);
    expect(() => keysetWhere(column, id, 'desc', undefined, 'id')).toThrow(
      /both lastCreatedAt and lastId/,
    );
  });

  it('emits ascending and descending comparators when the cursor is complete', () => {
    const asc = keysetWhere(
      column,
      id,
      'asc',
      '2026-11-18T00:00:00.000000+00:00',
      '123e4567-e89b-42d3-a456-426655440000',
    );
    const desc = keysetWhere(
      column,
      id,
      'desc',
      '2026-11-18T00:00:00.000000+00:00',
      '123e4567-e89b-42d3-a456-426655440000',
    );
    expect(asc).toBeDefined();
    expect(desc).toBeDefined();
  });
});

describe('keysetPage', () => {
  const rows = [
    { createdAtCursor: '2026-11-18T00:00:01.000000+00', id: 'a' },
    { createdAtCursor: '2026-11-18T00:00:02.000000+00', id: 'b' },
    { createdAtCursor: '2026-11-18T00:00:03.000000+00', id: 'c' },
  ];

  it('slices to the page and emits a cursor when there are extra rows', () => {
    const page = keysetPage(rows, 2, (row) => row.id);
    expect(page.items).toEqual(['a', 'b']);
    expect(page.next).toEqual({ lastCreatedAt: '2026-11-18T00:00:02.000000+00', lastId: 'b' });
  });

  it('returns a null cursor on the last page', () => {
    const page = keysetPage(rows.slice(0, 2), 2, (row) => row.id);
    expect(page.items).toEqual(['a', 'b']);
    expect(page.next).toBeNull();
  });

  it('handles an empty result set', () => {
    const page = keysetPage([], 10, (row: { createdAtCursor: string; id: string }) => row.id);
    expect(page.items).toEqual([]);
    expect(page.next).toBeNull();
  });
});

describe('buildListConditions', () => {
  const deletedAt = languages.deletedAt;
  const cursorAt = '2026-11-18T00:00:00.000000+00:00';
  const cursorId = '123e4567-e89b-42d3-a456-426655440000';

  it('selects live rows, appends extra filters and skips an absent cursor', () => {
    const extra = [eq(languages.id, cursorId)];
    const conditions = buildListConditions(deletedAt, false, undefined, extra);

    expect(conditions).toHaveLength(2);
    const [softDelete = '', filter = ''] = conditions.map(render);
    expect(softDelete).toContain('"deleted_at" is null');
    expect(softDelete).not.toContain('is not null');
    expect(filter).toContain('"id" = $1');
    expect(extra).toHaveLength(1);
  });

  it('selects soft-deleted rows and appends a descending keyset cursor', () => {
    const cursor = keysetWhere(languages.createdAt, languages.id, 'desc', cursorAt, cursorId);
    const conditions = buildListConditions(deletedAt, true, cursor, []);

    expect(conditions).toHaveLength(2);
    const [softDelete = '', tail = ''] = conditions.map(render);
    expect(softDelete).toContain('"deleted_at" is not null');
    expect(tail).toContain(' < (');
    expect(tail).toContain('::timestamptz');
    expect(tail).toContain('::uuid');
  });

  it('appends an ascending cursor after the extra filters', () => {
    const cursor = keysetWhere(languages.createdAt, languages.id, 'asc', cursorAt, cursorId);
    const conditions = buildListConditions(deletedAt, false, cursor, [eq(languages.id, cursorId)]);

    expect(conditions).toHaveLength(3);
    const [softDelete = '', filter = '', tail = ''] = conditions.map(render);
    expect(softDelete).toContain('"deleted_at" is null');
    expect(filter).toContain('"id" = $1');
    expect(tail).toContain(' > (');
  });
});

describe('orderByColumns', () => {
  it('orders by createdAt then id ascending', () => {
    const columns = orderByColumns(languages.createdAt, languages.id, 'asc');
    expect(columns.map(render)).toEqual(['"languages"."created_at" asc', '"languages"."id" asc']);
  });

  it('orders by createdAt then id descending', () => {
    const columns = orderByColumns(languages.createdAt, languages.id, 'desc');
    expect(columns.map(render)).toEqual(['"languages"."created_at" desc', '"languages"."id" desc']);
  });
});
