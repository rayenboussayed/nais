import type { ExecutionContext } from '@nestjs/common';

import { describe, expect, it } from 'vitest';

import { HEALTH_PATH } from '../modules/auth/public-path.js';
import { skipHealthProbe } from './throttle.js';

/**
 * Builds an ExecutionContext for the http path.
 * @param url - the request path, when any
 * @returns the context double
 */
function httpContext(url?: string): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => (url === undefined ? {} : { url }),
    }),
  } as unknown as ExecutionContext;
}

describe('skipHealthProbe', () => {
  it('skips health paths', () => {
    expect(skipHealthProbe(httpContext('/api/health'))).toBe(true);
    expect(skipHealthProbe(httpContext('/api/health/'))).toBe(true);
  });

  it('keeps startsWith semantics on the raw url (prefixes and queries still skip)', () => {
    expect(skipHealthProbe(httpContext(`${HEALTH_PATH}/foo`))).toBe(true);
    expect(skipHealthProbe(httpContext(`${HEALTH_PATH}?x=1`))).toBe(true);
    expect(skipHealthProbe(httpContext(`${HEALTH_PATH}foo`))).toBe(true);
    expect(skipHealthProbe(httpContext(`${HEALTH_PATH}///`))).toBe(true);
  });

  it('does not skip other paths', () => {
    expect(skipHealthProbe(httpContext('/api/languages'))).toBe(false);
    expect(skipHealthProbe(httpContext('/'))).toBe(false);
    expect(skipHealthProbe(httpContext(`/x${HEALTH_PATH}`))).toBe(false);
    expect(skipHealthProbe(httpContext('/API/HEALTH'))).toBe(false);
  });

  it('returns false when the request or url is missing', () => {
    expect(skipHealthProbe(httpContext())).toBe(false);
  });

  it('skips non-http contexts (the websocket gateway has its own limiter)', () => {
    const wsContext = {
      getType: () => 'ws',
    } as unknown as ExecutionContext;
    expect(skipHealthProbe(wsContext)).toBe(true);
  });

  it('returns false when switchToHttp throws', () => {
    const hostile = {
      switchToHttp: () => {
        throw new Error('nope');
      },
    } as unknown as ExecutionContext;
    expect(skipHealthProbe(hostile)).toBe(false);
  });
});
