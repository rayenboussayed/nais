import { describe, expect, it } from 'vitest';

import { setSttBodyLimit, STT_BODY_LIMIT, STT_ROUTE_PATH } from './body-limit.js';

/**
 * Builds a fresh, mutable route options object for the hook to act on.
 * @param url - the registered route path
 * @param method - one HTTP verb or the array Fastify also accepts
 * @param bodyLimit - a pre-existing limit used to check overwrite behavior
 * @returns a route options object carrying only the supplied fields
 */
function makeRoute(
  url: string,
  method: string | string[],
  bodyLimit?: number,
): { bodyLimit?: number; method: string | string[]; url: string } {
  return bodyLimit === undefined ? { method, url } : { bodyLimit, method, url };
}

describe('setSttBodyLimit', () => {
  it('uses the documented route path and byte limit', () => {
    expect(STT_ROUTE_PATH).toBe('/api/audio/stt');
    expect(STT_BODY_LIMIT).toBe(8 * 1024 * 1024);
  });

  it('sets the 8 MiB limit on POST to the exact STT path', () => {
    const route = makeRoute(STT_ROUTE_PATH, 'POST');

    setSttBodyLimit(route);

    expect(route.bodyLimit).toBe(STT_BODY_LIMIT);
  });

  it('leaves the limit unchanged for GET on the exact STT path', () => {
    const route = makeRoute(STT_ROUTE_PATH, 'GET');

    setSttBodyLimit(route);

    expect(route.bodyLimit).toBeUndefined();
  });

  it('leaves the limit unchanged for POST on another path', () => {
    const route = makeRoute('/api/translate', 'POST');

    setSttBodyLimit(route);

    expect(route.bodyLimit).toBeUndefined();
  });

  it('sets the limit when the method array contains POST', () => {
    const route = makeRoute(STT_ROUTE_PATH, ['GET', 'POST']);

    setSttBodyLimit(route);

    expect(route.bodyLimit).toBe(STT_BODY_LIMIT);
  });

  it('leaves the limit unchanged when the method array omits POST', () => {
    const route = makeRoute(STT_ROUTE_PATH, ['GET', 'HEAD']);

    setSttBodyLimit(route);

    expect(route.bodyLimit).toBeUndefined();
  });

  it('overwrites an existing limit only on the matching route', () => {
    const matching = makeRoute(STT_ROUTE_PATH, 'POST', 1024);
    const other = makeRoute('/api/translate', 'POST', 2048);

    setSttBodyLimit(matching);
    setSttBodyLimit(other);

    expect(matching.bodyLimit).toBe(STT_BODY_LIMIT);
    expect(other.bodyLimit).toBe(2048);
  });
});
