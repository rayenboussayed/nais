import { describe, expect, it } from 'vitest';

import { languages } from '../database/schema';

import { escapeLike, keysetWhere, timestamptzCursor } from './sql';

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

  it('returns undefined without a complete cursor', () => {
    expect(keysetWhere(column, id, 'desc', undefined, undefined)).toBeUndefined();
    expect(
      keysetWhere(column, id, 'desc', '2026-11-18T00:00:00.000000+00:00', undefined),
    ).toBeUndefined();
    expect(keysetWhere(column, id, 'desc', undefined, 'id')).toBeUndefined();
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
