import { describe, expect, it } from 'vitest';

import {
  isOriginAllowed,
  parseAllowedOrigins,
  buildGatewayCors,
  buildGatewayOptions,
} from './origin.js';

describe('buildGatewayCors', () => {
  it('returns undefined when no allowlist is configured', () => {
    expect(buildGatewayCors(undefined)).toBeUndefined();
    expect(buildGatewayCors('')).toBeUndefined();
    expect(buildGatewayCors('  , ,')).toBeUndefined();
  });

  it('returns an exact-match allowlist with credentials when configured', () => {
    expect(buildGatewayCors('https://a.example.com,https://b.example.com')).toEqual({
      origin: ['https://a.example.com', 'https://b.example.com'],
      credentials: true,
    });
  });
});

describe('buildGatewayOptions', () => {
  it('emits no cors key when the allowlist is empty', () => {
    const options = buildGatewayOptions(undefined);
    expect(options.path).toBe('/socket.io');
    expect(options.maxHttpBufferSize).toBe(65_536);
    expect('cors' in options).toBe(false);
  });

  it('includes an exact-match CORS allowlist when configured', () => {
    expect(buildGatewayOptions('https://admin.example.com, https://ops.example.com').cors).toEqual({
      origin: ['https://admin.example.com', 'https://ops.example.com'],
      credentials: true,
    });
  });
});

describe('isOriginAllowed', () => {
  it('allows requests without an Origin header (non-browser clients)', () => {
    expect(isOriginAllowed(undefined, 'api.example.com', [])).toBe(true);
  });

  it('allows same-origin requests', () => {
    expect(isOriginAllowed('https://api.example.com', 'api.example.com', [])).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:38706', '127.0.0.1:38706', [])).toBe(true);
  });

  it('rejects a different origin even for the same registrable domain', () => {
    expect(isOriginAllowed('https://evil.example.com', 'api.example.com', [])).toBe(false);
    expect(isOriginAllowed('https://api.example.com:8443', 'api.example.com', [])).toBe(false);
  });

  it('allows origins explicitly listed in the allowlist', () => {
    const allow = ['https://admin.example.com'];
    expect(isOriginAllowed('https://admin.example.com', 'api.example.com', allow)).toBe(true);
  });

  it('rejects unlisted origins', () => {
    const allow = ['https://admin.example.com'];
    expect(isOriginAllowed('https://other.example.com', 'api.example.com', allow)).toBe(false);
  });

  it('rejects malformed origin headers', () => {
    expect(isOriginAllowed('not a url', 'api.example.com', [])).toBe(false);
  });

  it('rejects javascript: origins outright', () => {
    expect(isOriginAllowed('javascript:alert(1)', 'api.example.com', [])).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims and drops empties', () => {
    expect(parseAllowedOrigins(' https://a.example.com, https://b.example.com,, ')).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('returns an empty list for undefined or empty input', () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins('')).toEqual([]);
  });
});
