import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { translationKeyFor } from './key.js';

function expectedKey(text: string): string {
  return createHash('sha512').update(text.normalize('NFC').trim()).digest('base64url');
}

describe('translationKeyFor', () => {
  it('hashes the NFC-normalized trimmed text with sha512/base64url', () => {
    expect(translationKeyFor('hello')).toBe(expectedKey('hello'));
  });

  it('is stable under surrounding whitespace', () => {
    expect(translationKeyFor('  hello  ')).toBe(translationKeyFor('hello'));
  });

  it('is stable for canonically equivalent unicode', () => {
    // é composed vs e + combining acute
    const composed = 'caf\u00e9';
    const decomposed = 'cafe\u0301';
    expect(translationKeyFor(composed)).toBe(translationKeyFor(decomposed));
  });

  it('differs for different texts', () => {
    expect(translationKeyFor('hello')).not.toBe(translationKeyFor('world'));
  });

  it('matches a known sha512/base64url vector', () => {
    expect(translationKeyFor('hello')).toBe(
      'm3HSJL1i83hdltRq0-o9czGb-8KJDKra4t_3JRlnPKcjI8PZm6XBHXx6zG4UuMXaDEZjR1wuXDre9G9zvN7AQw',
    );
  });
});
