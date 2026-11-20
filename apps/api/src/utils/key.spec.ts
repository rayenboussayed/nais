import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { inputHashFor, taskKeyFor, translationKeyFor } from './key.js';

/**
 * Computes the expected cache key to compare against.
 * @param text - the source text
 * @returns the expected sha512-base64url key
 */
function expectedKey(text: string): string {
  return createHash('sha512').update(text.normalize('NFC').trim()).digest('base64url');
}

/**
 * Builds an object whose keys follow the supplied entry order.
 * Lets the golden tests use insertion orders a sorted object literal cannot express.
 * @param entries - ordered key/value pairs
 * @returns an object with keys in the exact order of `entries`
 */
function orderedObject(
  entries: ReadonlyArray<readonly [string, unknown]>,
): Record<string, unknown> {
  return Object.fromEntries(entries);
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

  it('matches a golden byte vector for canonically-equivalent unicode', () => {
    // Both NFC forms must produce the exact same digest bytes.
    const golden =
      'DJ2sf-YTcZFweQ8Ipfe59e-HbHtX_0KQdL9BeWnCxUEH2STa9ecGVor8pHEtkdoc_fd1iNdkA6hFF34j4664zg';
    expect(translationKeyFor('caf\u00e9')).toBe(golden);
    expect(translationKeyFor('cafe\u0301')).toBe(golden);
  });

  it('matches a golden byte vector for empty input', () => {
    expect(translationKeyFor('')).toBe(
      'z4PhNX7vuL3xVChQ1m2AB9Yg5AULVxXcg_SpIdNs6c5H0NE8XYXysP-DGNKHfuwvY7kxvUdBeoGlODJ6-SfaPg',
    );
  });
});

describe('inputHashFor', () => {
  it('matches a golden byte vector for empty input', () => {
    expect(inputHashFor({})).toBe(
      'J8dGcK23UHX60FjVzq97IMTneGyDuuijL2Jvl4KvNMmjPCBG72D9Knh403jin-yFGAa72aZ4ePOp8c2kgwdj_Q',
    );
  });

  it('matches a golden byte vector for nested objects with stable key order', () => {
    const golden =
      'sTwYHLTRf3GI27XKv9G48HDQwQpw9smxTkCl1rwgb5z6B4_BxShC0GFk_demMaPwcH-7qE4VatOXC7p3RdAIwA';
    expect(inputHashFor({ a: 'text', b: { x: 2, y: 1 } })).toBe(golden);
    expect(
      inputHashFor(
        orderedObject([
          [
            'b',
            orderedObject([
              ['y', 1],
              ['x', 2],
            ]),
          ],
          ['a', 'text'],
        ]),
      ),
    ).toBe(golden);
  });

  it('matches a golden byte vector for unicode nested input', () => {
    const golden =
      'lfWLGDLCeV1wZWM5hwf7RcaCegP76zClvJaHJ8uNjfCJL2yiaNotNn1P7E0CzC6QjttezRAWd1SA2iopoJjPew';
    expect(inputHashFor({ name: 'cafe\u0301' })).toBe(golden);
    expect(inputHashFor({ name: 'caf\u00e9' })).toBe(golden);
  });

  it('is stable under object key order', () => {
    expect(
      inputHashFor(
        orderedObject([
          ['b', 2],
          ['a', 1],
        ]),
      ),
    ).toBe(inputHashFor({ a: 1, b: 2 }));
  });
});

describe('taskKeyFor', () => {
  it('matches a golden byte vector for a typical task invocation', () => {
    expect(taskKeyFor('sentiment', 'bonsai-2:2b', { text: 'hello' })).toBe(
      'xow0eaOFkGO7XMmvArhyfoCQID3o2N2UBSL4IWzX-1o7g-jdTTebSlpboZWwJnd_yNSanrt7vpLgoZYUmSVQ6A',
    );
  });

  it('matches a golden byte vector for empty input', () => {
    expect(taskKeyFor('sentiment', 'bonsai-2:2b', {})).toBe(
      'h6anNhPaIXsdBrLPiYcsCb2_CTafMslbNCYjuBgJNTpwBDDmzzP6F6JbdYJ3jpyQyPsPf9Osu8cK1vxeJKw60A',
    );
  });

  it('matches a golden byte vector for nested unicode input with stable key order', () => {
    const golden =
      'lhChAEP78IHGJvEWzLih8gneX1gVOrptt1FNVOTTfrBFtkX8OWfLKdeJSIGB2eRO_4pTf7aSAB6rZIUdN6uRiA';
    expect(taskKeyFor('summarize', 'm1', { a: 'caf\u00e9', b: { x: 2, y: 1 } })).toBe(golden);
    expect(
      taskKeyFor(
        'summarize',
        'm1',
        orderedObject([
          [
            'b',
            orderedObject([
              ['y', 1],
              ['x', 2],
            ]),
          ],
          ['a', 'cafe\u0301'],
        ]),
      ),
    ).toBe(golden);
  });

  it('is stable under object key order', () => {
    expect(
      taskKeyFor(
        't',
        'm',
        orderedObject([
          ['b', 2],
          ['a', 1],
        ]),
      ),
    ).toBe(taskKeyFor('t', 'm', { a: 1, b: 2 }));
  });
});
