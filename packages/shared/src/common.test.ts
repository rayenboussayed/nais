import { describe, expect, it } from 'vitest';

import { iso6391Schema, paginationSchema } from './common';

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

  it('rejects queries longer than 255 characters', () => {
    expect(() => paginationSchema.parse({ q: 'a'.repeat(256) })).toThrow();
  });
});
