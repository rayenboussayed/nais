import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { skipHealthProbe } from './throttle';

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

  it('does not skip other paths', () => {
    expect(skipHealthProbe(httpContext('/api/languages'))).toBe(false);
    expect(skipHealthProbe(httpContext('/'))).toBe(false);
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
