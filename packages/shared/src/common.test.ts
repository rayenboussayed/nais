import { describe, expect, it } from 'vitest';

import { cursorTimestampSchema, iso6391Schema, paginationSchema } from './common';

describe('iso6391Schema', () => {
  it('accepts two-letter lowercase codes', () => {
    expect(iso6391Schema.parse('en')).toBe('en');
    expect(iso6391Schema.parse('ar')).toBe('ar');
  });

  it('rejects malformed codes', () => {
    for (const input of ['', 'e', 'eng', 'EN', 'e1', '1a']) {
      expect(() => iso6391Schema.parse(input)).toThrow();
    }
  });
});

describe('paginationSchema', () => {
  it('applies defaults', () => {
    expect(paginationSchema.parse({})).toEqual({
      pageSize: 20,
      orderBy: 'desc',
      onlyDeleted: false,
    });
  });

  it('coerces numeric strings from query params', () => {
    const parsed = paginationSchema.parse({ pageSize: '50' });
    expect(parsed.pageSize).toBe(50);
    expect(() => paginationSchema.parse({ pageSize: '101' })).toThrow();
    expect(() => paginationSchema.parse({ pageSize: '0' })).toThrow();
    expect(() => paginationSchema.parse({ pageSize: 'abc' })).toThrow();
  });

  it('parses stringbool onlyDeleted values correctly', () => {
    expect(paginationSchema.parse({ onlyDeleted: 'false' }).onlyDeleted).toBe(false);
    expect(paginationSchema.parse({ onlyDeleted: 'true' }).onlyDeleted).toBe(true);
    expect(paginationSchema.parse({ onlyDeleted: '1' }).onlyDeleted).toBe(true);
  });

  it('rejects a partial cursor pair', () => {
    expect(() =>
      paginationSchema.parse({ lastId: '123e4567-e89b-42d3-a456-426655440000' }),
    ).toThrow();
    expect(() =>
      paginationSchema.parse({ lastCreatedAt: '2026-11-18T00:00:00.000000+00:00' }),
    ).toThrow();
  });

  it('rejects an invalid cursor timestamp', () => {
    expect(() =>
      paginationSchema.parse({
        lastId: '123e4567-e89b-42d3-a456-426655440000',
        lastCreatedAt: 'not-a-timestamp',
      }),
    ).toThrow();
  });

  it('rejects invalid orderBy and uuids', () => {
    expect(() => paginationSchema.parse({ orderBy: 'newest' })).toThrow();
    expect(() => paginationSchema.parse({ lastId: 'not-a-uuid' })).toThrow();
  });

  it('parses a valid cursor and query string', () => {
    const parsed = paginationSchema.parse({
      lastId: '123e4567-e89b-42d3-a456-426655440000',
      lastCreatedAt: '2026-11-18T00:00:00.000Z',
      q: 'hello',
    });
    expect(parsed.lastId).toBe('123e4567-e89b-42d3-a456-426655440000');
    expect(parsed.lastCreatedAt).toBe('2026-11-18T00:00:00.000Z');
    expect(parsed.q).toBe('hello');
  });

  it('accepts the three pg timestamptz offset shapes', () => {
    for (const value of [
      '2026-11-18T23:05:21.809035+00',
      '2026-11-18T23:05:21.809035+00:00',
      '2026-11-18T23:05:21.809035Z',
    ]) {
      expect(cursorTimestampSchema.parse(value).length).toBeGreaterThan(10);
    }
  });

  it('rejects calendar-impossible instants', () => {
    expect(() => cursorTimestampSchema.parse('9999-99-99T99:99:99+99')).toThrow();
  });

  it('rejects cursors with malformed shape', () => {
    expect(() => cursorTimestampSchema.parse('2026-11-18 23:05:21.809035+00')).toThrow();
    expect(() => cursorTimestampSchema.parse('not-a-date')).toThrow();
  });

  it('rejects queries longer than 255 characters', () => {
    expect(() => paginationSchema.parse({ q: 'a'.repeat(256) })).toThrow();
  });
});
