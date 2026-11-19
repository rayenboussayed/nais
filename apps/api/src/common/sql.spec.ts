import { describe, expect, it } from 'vitest';

import { languages } from '../database/schema.js';

import { escapeLike, keysetPage, keysetWhere, timestamptzCursor } from './sql.js';

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
    { id: 'a', createdAtCursor: '2026-11-18T00:00:01.000000+00' },
    { id: 'b', createdAtCursor: '2026-11-18T00:00:02.000000+00' },
    { id: 'c', createdAtCursor: '2026-11-18T00:00:03.000000+00' },
  ];

  it('slices to the page and emits a cursor when there are extra rows', () => {
    const page = keysetPage(rows, 2, (row) => row.id);
    expect(page.items).toEqual(['a', 'b']);
    expect(page.next).toEqual({ lastId: 'b', lastCreatedAt: '2026-11-18T00:00:02.000000+00' });
  });

  it('returns a null cursor on the last page', () => {
    const page = keysetPage(rows.slice(0, 2), 2, (row) => row.id);
    expect(page.items).toEqual(['a', 'b']);
    expect(page.next).toBeNull();
  });

  it('handles an empty result set', () => {
    const page = keysetPage([], 10, (row: { id: string; createdAtCursor: string }) => row.id);
    expect(page.items).toEqual([]);
    expect(page.next).toBeNull();
  });
});
