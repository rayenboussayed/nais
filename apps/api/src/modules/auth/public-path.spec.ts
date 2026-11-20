import { describe, expect, it } from 'vitest';

import { HEALTH_PATH, LOGIN_PATH, normalizePath } from './public-path.js';

describe('public path constants', () => {
  it('holds the canonical public path literals', () => {
    expect(HEALTH_PATH).toBe('/api/health');
    expect(LOGIN_PATH).toBe('/api/auth/login');
  });
});

describe('normalizePath', () => {
  it('leaves a bare path unchanged', () => {
    expect(normalizePath(HEALTH_PATH)).toBe(HEALTH_PATH);
    expect(normalizePath(LOGIN_PATH)).toBe(LOGIN_PATH);
  });

  it('strips the query string', () => {
    expect(normalizePath(`${HEALTH_PATH}?probe=1`)).toBe(HEALTH_PATH);
    expect(normalizePath(`${LOGIN_PATH}?next=%2Fadmin&x=1`)).toBe(LOGIN_PATH);
  });

  it('strips one or more trailing slashes', () => {
    expect(normalizePath(`${HEALTH_PATH}/`)).toBe(HEALTH_PATH);
    expect(normalizePath(`${HEALTH_PATH}///`)).toBe(HEALTH_PATH);
  });

  it('strips the query and trailing slashes regardless of their order', () => {
    expect(normalizePath(`${HEALTH_PATH}///?probe=1`)).toBe(HEALTH_PATH);
    expect(normalizePath(`${HEALTH_PATH}?probe=1///`)).toBe(HEALTH_PATH);
  });

  it('reduces the root path to the empty string', () => {
    expect(normalizePath('/')).toBe('');
  });

  it('does not collapse interior slashes or decode the path', () => {
    expect(normalizePath(`/${HEALTH_PATH}//`)).toBe(`/${HEALTH_PATH}`);
    expect(normalizePath('/api/%68ealth')).toBe('/api/%68ealth');
  });

  it('turns a query-only URL into the empty string', () => {
    expect(normalizePath('?probe=1')).toBe('');
  });
});
