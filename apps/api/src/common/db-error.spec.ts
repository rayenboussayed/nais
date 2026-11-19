import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from './db-error.js';

describe('isUniqueViolation', () => {
  it('detects a top-level 23505 (pg error code)', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
  });

  it('detects a 23505 wrapped as cause (drizzle DrizzleQueryError)', () => {
    expect(isUniqueViolation(new Error('query failed', { cause: { code: '23505' } }))).toBe(true);
  });

  it('detects a doubly-wrapped 23505', () => {
    expect(isUniqueViolation({ cause: { cause: { code: '23505' } } })).toBe(true);
  });

  it('returns false for other errors, missing codes and non-objects', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({ code: '42P01' })).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
    expect(isUniqueViolation({ cause: undefined })).toBe(false);
    expect(isUniqueViolation({ cause: { code: 'XX000' } })).toBe(false);
  });

  it('finds a deeply nested 23505', () => {
    expect(isUniqueViolation({ cause: { cause: { cause: { cause: { code: '23505' } } } } })).toBe(
      true,
    );
  });

  it('terminates on a self-referential cause chain', () => {
    const loop: { code?: string; cause?: unknown } = {};
    loop.cause = loop;
    expect(isUniqueViolation(loop)).toBe(false);
  });

  it('returns false for a deeply nested non-matching chain', () => {
    let node: { code?: string; cause?: unknown } = { code: '22001' };
    for (let i = 0; i < 12; i += 1) {
      node = { cause: node };
    }
    expect(isUniqueViolation(node)).toBe(false);
  });
});
