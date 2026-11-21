import { describe, expect, it } from 'vitest';

import {
  createLanguageSchema,
  languageSchema,
  updateLanguageBodySchema,
  updateLanguageSchema,
} from './languages.js';

describe('createLanguageSchema', () => {
  it('parses a full valid input and defaults isSource', () => {
    const parsed = createLanguageSchema.parse({
      dir: 'rtl',
      iso6391: 'ar',
      name: 'Arabic',
      nativeName: 'العربية',
    });
    expect(parsed.isSource).toBe(false);
    expect(parsed.dir).toBe('rtl');
  });

  it('rejects missing required fields', () => {
    expect(() => createLanguageSchema.parse({ name: 'Arabic' })).toThrow();
    expect(() =>
      createLanguageSchema.parse({ iso6391: 'ar', name: 'Arabic', nativeName: 'العربية' }),
    ).toThrow();
  });

  it('rejects names longer than 255 characters', () => {
    expect(() =>
      createLanguageSchema.parse({
        dir: 'ltr',
        iso6391: 'en',
        name: 'x'.repeat(256),
        nativeName: 'y',
      }),
    ).toThrow();
  });

  it('rejects invalid enum and code values', () => {
    expect(() =>
      createLanguageSchema.parse({ dir: 'up', iso6391: 'en', name: 'n', nativeName: 'n' }),
    ).toThrow();
    expect(() =>
      createLanguageSchema.parse({ dir: 'ltr', iso6391: 'eng', name: 'n', nativeName: 'n' }),
    ).toThrow();
  });

  it('trims surrounding whitespace from names', () => {
    expect(
      createLanguageSchema.parse({
        dir: 'ltr',
        iso6391: 'en',
        name: '  English  ',
        nativeName: ' English ',
      }).name,
    ).toBe('English');
  });
});

describe('updateLanguageBodySchema', () => {
  it('rejects an empty patch', () => {
    expect(() => updateLanguageBodySchema.parse({})).toThrow();
  });

  it('accepts a single defined field and rejects undefined-only', () => {
    expect(updateLanguageBodySchema.parse({ isSource: true }).isSource).toBe(true);
    expect(() => updateLanguageBodySchema.parse({ isSource: undefined })).toThrow();
  });

  it('accepts an iso-only patch', () => {
    expect(updateLanguageBodySchema.parse({ iso6391: 'de' }).iso6391).toBe('de');
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
    expect(
      updateLanguageSchema.parse({
        id: '123e4567-e89b-42d3-a456-426655440000',
        name: 'German',
      }).name,
    ).toBe('German');
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
      createdAt: '2026-11-18T00:00:00.000Z',
      deletedAt: null,
      dir: 'ltr',
      id: '123e4567-e89b-42d3-a456-426655440000',
      iso6391: 'en',
      isSource: true,
      name: 'English',
      nativeName: 'English',
      updatedAt: '2026-11-18T00:00:00.000Z',
    });
    expect(parsed.isSource).toBe(true);
    expect(parsed.deletedAt).toBeNull();
  });

  it('rejects rows with a non-null malformed deletedAt', () => {
    expect(() =>
      languageSchema.parse({
        createdAt: 'not-a-date',
        deletedAt: null,
        dir: 'ltr',
        id: '123e4567-e89b-42d3-a456-426655440000',
        iso6391: 'en',
        isSource: false,
        name: 'English',
        nativeName: 'English',
        updatedAt: '2026-11-18T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
