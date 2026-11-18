import { describe, expect, it } from 'vitest';

import {
  createLanguageSchema,
  languageSchema,
  updateLanguageSchema,
} from './languages';

describe('createLanguageSchema', () => {
  it('parses a full valid input and defaults isSource', () => {
    const parsed = createLanguageSchema.parse({
      name: 'Arabic',
      nativeName: 'العربية',
      iso6391: 'ar',
      dir: 'rtl',
    });
    expect(parsed.isSource).toBe(false);
    expect(parsed.dir).toBe('rtl');
  });

  it('rejects missing required fields', () => {
    expect(() => createLanguageSchema.parse({ name: 'Arabic' })).toThrow();
    expect(() =>
      createLanguageSchema.parse({ name: 'Arabic', nativeName: 'العربية', iso6391: 'ar' }),
    ).toThrow();
  });

  it('rejects names longer than 255 characters', () => {
    expect(() =>
      createLanguageSchema.parse({
        name: 'x'.repeat(256),
        nativeName: 'y',
        iso6391: 'en',
        dir: 'ltr',
      }),
    ).toThrow();
  });

  it('rejects invalid enum and code values', () => {
    expect(() =>
      createLanguageSchema.parse({ name: 'n', nativeName: 'n', iso6391: 'en', dir: 'up' }),
    ).toThrow();
    expect(() =>
      createLanguageSchema.parse({ name: 'n', nativeName: 'n', iso6391: 'eng', dir: 'ltr' }),
    ).toThrow();
  });

  it('trims surrounding whitespace from names', () => {
    expect(
      createLanguageSchema.parse({
        name: '  English  ',
        nativeName: ' English ',
        iso6391: 'en',
        dir: 'ltr',
      }).name,
    ).toBe('English');
  });
});

describe('updateLanguageSchema', () => {
  it('rejects a patch with no fields besides id', () => {
    expect(() =>
      updateLanguageSchema.parse({ id: '123e4567-e89b-42d3-a456-426655440000' }),
    ).toThrow();
    expect(() => updateLanguageSchema.parse({})).toThrow();
  });

  it('accepts a single-field patch', () => {
    const parsed = updateLanguageSchema.parse({
      id: '123e4567-e89b-42d3-a456-426655440000',
      isSource: true,
    });
    expect(parsed.isSource).toBe(true);
  });

  it('accepts a single string field patch', () => {
    expect(updateLanguageSchema.parse({
      id: '123e4567-e89b-42d3-a456-426655440000',
      name: 'German',
    }).name).toBe('German');
  });

  it('rejects undefined-only patches', () => {
    expect(() =>
      updateLanguageSchema.parse({ id: '123e4567-e89b-42d3-a456-426655440000', name: undefined }),
    ).toThrow();
  });
});

describe('languageSchema', () => {
  it('parses a stored row', () => {
    const parsed = languageSchema.parse({
      id: '123e4567-e89b-42d3-a456-426655440000',
      name: 'English',
      nativeName: 'English',
      iso6391: 'en',
      dir: 'ltr',
      isSource: true,
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
      deletedAt: null,
    });
    expect(parsed.isSource).toBe(true);
    expect(parsed.deletedAt).toBeNull();
  });

  it('rejects rows with a non-null malformed deletedAt', () => {
    expect(() =>
      languageSchema.parse({
        id: '123e4567-e89b-42d3-a456-426655440000',
        name: 'English',
        nativeName: 'English',
        iso6391: 'en',
        dir: 'ltr',
        isSource: false,
        createdAt: 'not-a-date',
        updatedAt: '2026-11-18T00:00:00.000Z',
        deletedAt: null,
      }),
    ).toThrow();
  });
});
