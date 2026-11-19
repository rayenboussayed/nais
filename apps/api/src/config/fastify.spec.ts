import { describe, expect, it } from 'vitest';

import { resolveTrustProxy } from './fastify';

describe('resolveTrustProxy', () => {
  it('maps each documented value', () => {
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('false')).toBe(false);
    expect(resolveTrustProxy('loopback')).toBe('loopback');
  });
});
