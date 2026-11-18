import { describe, expect, it } from 'vitest';

import { validateEnv } from './env';

const baseEnv = { NODE_ENV: 'development' } as NodeJS.ProcessEnv;

describe('validateEnv', () => {
  it('applies development defaults', () => {
    const env = validateEnv(baseEnv);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_URL).toContain('postgresql://');
    expect(env.OLLAMA_TEXT_MODEL).toBe('bonsai-2:2b');
    expect(env.LOG_TEXT).toBe(false);
  });

  it('keeps development defaults when NODE_ENV is unset', () => {
    expect(validateEnv({}).NODE_ENV).toBe('development');
    expect(validateEnv({}).DATABASE_URL).toContain('localhost');
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

  it('fails fast in production without BASIC_AUTH_PASSWORD_HASH and SESSION_SECRET', () => {
    expect(() =>
      validateEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db:5432/trainslator' }),
    ).toThrow(/BASIC_AUTH_PASSWORD_HASH/);
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        BASIC_AUTH_PASSWORD_HASH: 'scrypt$16384$8$1$' + 'a'.repeat(32) + '$' + 'b'.repeat(128),
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('fails fast in production without DATABASE_URL', () => {
    expect(() => validateEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
  });

  it('rejects a malformed BASIC_AUTH_PASSWORD_HASH in production', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        BASIC_AUTH_PASSWORD_HASH: 'not-a-scrypt-hash',
        SESSION_SECRET: 'a'.repeat(64),
      }),
    ).toThrow(/BASIC_AUTH_PASSWORD_HASH/);
  });

  it('rejects a SESSION_SECRET that is not 64 lowercase hex chars', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
        BASIC_AUTH_PASSWORD_HASH: 'scrypt$16384$8$1$aaaa$bbbb',
        SESSION_SECRET: 'not-hex-but-long-enough-to-trick-a-length-check-000000000000000000000000000000000000',
      }),
    ).toThrow(/SESSION_SECRET/);
  });

  it('accepts a complete production env', () => {
    const env = validateEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db:5432/trainslator',
      BASIC_AUTH_PASSWORD_HASH: 'scrypt$16384$8$1$aaaa$bbbb',
      SESSION_SECRET: 'a'.repeat(64),
      PG_BOSS_URL: 'postgresql://u:p@db:5432/trainslator_pgboss',
      CORS_ORIGINS: 'https://admin.example.com',
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
  });
});
