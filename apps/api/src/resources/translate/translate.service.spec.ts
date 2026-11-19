import { describe, expect, it } from 'vitest';

import { isTimeoutError } from './translate.service.js';

describe('isTimeoutError', () => {
  it('matches abort and timeout error names', () => {
    expect(isTimeoutError(new Error('x'))).toBe(false);
    const aborted = new Error('x');
    aborted.name = 'AbortError';
    expect(isTimeoutError(aborted)).toBe(true);
    const timeout = new Error('x');
    timeout.name = 'TimeoutError';
    expect(isTimeoutError(timeout)).toBe(true);
  });

  it('matches timeout phrasing in messages', () => {
    expect(isTimeoutError(new Error('request timed out'))).toBe(true);
    expect(isTimeoutError(new Error('operation TIMEOUT'))).toBe(true);
    expect(isTimeoutError(new Error('ETIMEDOUT 127.0.0.1'))).toBe(true);
    expect(isTimeoutError(new Error('timed out after 60s'))).toBe(true);
  });

  it('returns false for a cause chain deeper than the walk bound', () => {
    let node: Error = new Error('root');
    for (let i = 0; i < 12; i += 1) {
      node = Object.assign(new Error('wrap'), { cause: node });
    }
    expect(isTimeoutError(node)).toBe(false);
  });

  it('returns false for unrelated errors and non-errors', () => {
    expect(isTimeoutError(new Error('model returned an empty completion'))).toBe(false);
    expect(isTimeoutError(undefined)).toBe(false);
    expect(isTimeoutError('timeout')).toBe(false);
  });
});
