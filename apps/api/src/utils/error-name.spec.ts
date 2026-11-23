import { describe, expect, it } from 'vitest';

import { errorName } from './error-name.js';

describe('errorName', () => {
  it('uses the name of an Error instance', () => {
    expect(errorName(new Error('boom'))).toBe('Error');
    expect(errorName(new TypeError('boom'))).toBe('TypeError');
  });

  it('uses the default fallback for non-Error values', () => {
    expect(errorName('boom')).toBe('unknown error');
    expect(errorName(42)).toBe('unknown error');
    expect(errorName(null)).toBe('unknown error');
    expect(errorName(undefined)).toBe('unknown error');
    expect(errorName({ message: 'boom', name: 'FakeError' })).toBe('unknown error');
  });

  it('uses the custom fallback for non-Error values', () => {
    expect(errorName('boom', 'string')).toBe('string');
    expect(errorName({ name: 'FakeError' }, 'object')).toBe('object');
    expect(errorName(null, typeof null)).toBe('object');
  });

  it('ignores the custom fallback for Error instances', () => {
    expect(errorName(new RangeError('boom'), 'ignored')).toBe('RangeError');
  });
});
