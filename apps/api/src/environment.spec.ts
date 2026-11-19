import { describe, expect, it } from 'vitest';

import { validateEnv } from './environment.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://trainslator:change-me@localhost:5432/trainslator',
  NODE_ENV: 'development',
  SESSION_SECRET: 'a'.repeat(64),
} as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('applies development defaults', () => {
    const env = validateEnv(baseEnv);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain('localhost');
    expect(env.OLLAMA_TEXT_MODEL).toBe('bonsai-2:2b');
  });

  it('requires DATABASE_URL in every environment (even development)', () => {
    expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('defaults NODE_ENV to development when unset', () => {
    expect(
      validateEnv({
        DATABASE_URL: 'postgresql://u:p@db:5432/x',
        SESSION_SECRET: 'a'.repeat(64),
      }).NODE_ENV,
    ).toBe('development');
  });

  it('coerces PORT from the environment string', () => {
    expect(validateEnv({ ...baseEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a non-numeric PORT with a readable message', () => {
    expect(() => validateEnv({ ...baseEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ NODE_ENV: 'staging-ish' })).toThrow(/NODE_ENV/);
  });

  it('fails fast in production without BASIC_AUTH_PASSWORD_HASH', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        NODE_ENV: 'production',
        SESSION_SECRET: 'a'.repeat(64),
      }),
    ).toThrow(/BASIC_AUTH_PASSWORD_HASH/);
  });

  it('requires SESSION_SECRET in every environment, including development', () => {
    expect(() =>
      validateEnv({
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        NODE_ENV: 'development',
      }),
    ).toThrow(/SESSION_SECRET/);
    expect(() =>
      validateEnv({
        BASIC_AUTH_PASSWORD_HASH: 'scrypt$16384$8$1$' + 'a'.repeat(32) + '$' + 'b'.repeat(128),
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        NODE_ENV: 'production',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('fails fast in production without DATABASE_URL', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a malformed BASIC_AUTH_PASSWORD_HASH in production', () => {
    expect(() =>
      validateEnv({
        // eslint-disable-next-line sonarjs/no-hardcoded-passwords -- test fixture: deliberately malformed hash to exercise validation
        BASIC_AUTH_PASSWORD_HASH: 'not-a-scrypt-hash',
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        NODE_ENV: 'production',
        SESSION_SECRET: 'a'.repeat(64),
      }),
    ).toThrow(/BASIC_AUTH_PASSWORD_HASH/);
  });

  it('rejects a SESSION_SECRET that is not 64 lowercase hex chars', () => {
    expect(() =>
      validateEnv({
        BASIC_AUTH_PASSWORD_HASH: 'scrypt$16384$8$1$aaaa$bbbb',
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        NODE_ENV: 'production',
        SESSION_SECRET:
          'not-hex-but-long-enough-to-trick-a-length-check-000000000000000000000000000000000000',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('accepts a complete production env', () => {
    const env = validateEnv({
      BASIC_AUTH_PASSWORD_HASH: 'scrypt$16384$8$1$aaaa$bbbb',
      CORS_ORIGINS: 'https://admin.example.com',
      DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
      NODE_ENV: 'production',
      PG_BOSS_URL: 'postgresql://u:p@db:5432/trainslator_pgboss',
      SESSION_SECRET: 'a'.repeat(64),
    });
    expect(env.PG_BOSS_URL).toContain('trainslator_pgboss');
  });

  it('coalesces PG_BOSS_URL to DATABASE_URL when unset', () => {
    const env = validateEnv({
      ...baseEnv,
      DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
    });
    expect(env.PG_BOSS_URL).toBe('postgresql://u:p@db:5432/trainslator');
  });

  it('rejects an invalid DATABASE_URL', () => {
    expect(() => validateEnv({ ...baseEnv, DATABASE_URL: 'not a url' })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...baseEnv, DATABASE_URL: 'postgresql://' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('accepts a unix-socket DSN (pg accepts it, WHATWG would not)', () => {
    const env = validateEnv({
      ...baseEnv,
      DATABASE_URL: 'postgresql://postgres@/dbname?host=%2Ftmp%2Fsocketdir&port=55432',
    });
    expect(env.DATABASE_URL).toContain('host=%2Ftmp%2Fsocketdir');
  });

  it('coerces THROTTLE_LIMIT and applies the default', () => {
    expect(validateEnv({ ...baseEnv }).THROTTLE_LIMIT).toBe(100);
    expect(validateEnv({ ...baseEnv, THROTTLE_LIMIT: '42' }).THROTTLE_LIMIT).toBe(42);
    expect(() => validateEnv({ ...baseEnv, THROTTLE_LIMIT: '0' })).toThrow(/THROTTLE_LIMIT/);
  });

  it('accepts a libpq key=value DSN', () => {
    const env = validateEnv({
      ...baseEnv,
      DATABASE_URL: 'host=/tmp/socketdir port=55432 dbname=x',
    });
    expect(env.DATABASE_URL).toContain('host=');
  });

  it('leaves AI_DEVICE unset by default (automatic webgpu → cpu chain)', () => {
    expect(validateEnv({ ...baseEnv }).AI_DEVICE).toBeUndefined();
  });

  it('accepts each AI_DEVICE pin and rejects unknown values', () => {
    for (const device of ['webgpu', 'cpu']) {
      expect(validateEnv({ ...baseEnv, AI_DEVICE: device }).AI_DEVICE).toBe(device);
    }
    expect(() => validateEnv({ ...baseEnv, AI_DEVICE: 'cuda' })).toThrow(/AI_DEVICE/);
    expect(() => validateEnv({ ...baseEnv, AI_DEVICE: 'wasm' })).toThrow(/AI_DEVICE/);
  });
});
