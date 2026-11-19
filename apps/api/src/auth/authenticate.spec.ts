import { randomBytes, scryptSync } from 'node:crypto';

import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env';

import { SESSION_COOKIE_NAME, signSession } from './session';
import { authenticateHeaders } from './authenticate';

const SECRET = 'b'.repeat(64);
const PASSWORD = 'admin-password';

function makeHash(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$16384$8$1$${salt.toString('hex')}$${scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')}`;
}

function configStub(overrides: Record<string, string | undefined> = {}): ConfigService<Env, true> {
  const base: Record<string, string | undefined> = {
    BASIC_AUTH_USERNAME: 'admin',
    BASIC_AUTH_PASSWORD_HASH: makeHash(PASSWORD),
    SESSION_SECRET: SECRET,
    ...overrides,
  };
  return {
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
}

function basic(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('authenticateHeaders', () => {
  it('authenticates a valid basic auth header', async () => {
    const result = await authenticateHeaders(
      { authorization: basic('admin', PASSWORD) },
      configStub(),
    );
    expect(result).toEqual({ username: 'admin' });
  });

  it('rejects a basic auth header with a wrong password', async () => {
    expect(
      await authenticateHeaders({ authorization: basic('admin', 'wrong') }, configStub()),
    ).toBeNull();
  });

  it('rejects a basic auth header with a wrong username', async () => {
    expect(
      await authenticateHeaders({ authorization: basic('root', PASSWORD) }, configStub()),
    ).toBeNull();
  });

  it('rejects a basic auth header without a password part', async () => {
    const malformed = `Basic ${Buffer.from('admin').toString('base64')}`;
    expect(await authenticateHeaders({ authorization: malformed }, configStub())).toBeNull();
  });

  it('rejects a basic auth header with invalid base64 text', async () => {
    expect(
      await authenticateHeaders({ authorization: 'Basic !!! not base64 ###' }, configStub()),
    ).toBeNull();
  });

  it('accepts first-value array headers', async () => {
    expect(
      await authenticateHeaders({ authorization: [basic('admin', PASSWORD)] }, configStub()),
    ).toEqual({ username: 'admin' });
  });

  it('authenticates with a valid session cookie', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=${signSession('admin', SECRET).value}`;
    expect(await authenticateHeaders({ cookie }, configStub())).toEqual({ username: 'admin' });
  });

  it('rejects an invalid session cookie', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=deadbeef.sig`;
    expect(await authenticateHeaders({ cookie }, configStub())).toBeNull();
  });

  it('treats malformed percent-encoding as unauthenticated instead of throwing', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=%`;
    await expect(authenticateHeaders({ cookie }, configStub())).resolves.toBeNull();
  });

  it('rejects an expired session cookie', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=${signSession('admin', SECRET, -1_000).value}`;
    expect(await authenticateHeaders({ cookie }, configStub())).toBeNull();
  });

  it('ignores an unrelated cookie when the session cookie is absent', async () => {
    expect(await authenticateHeaders({ cookie: 'theme=dark' }, configStub())).toBeNull();
  });

  it('returns null when neither credential is present', async () => {
    expect(await authenticateHeaders({}, configStub())).toBeNull();
  });

  it('an authorization header wins over a cookie', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=deadbeef.sig`;
    expect(
      await authenticateHeaders({ authorization: basic('admin', PASSWORD), cookie }, configStub()),
    ).toEqual({ username: 'admin' });
  });

  it('a bad password wins over a good cookie (never falls back)', async () => {
    const cookie = `${SESSION_COOKIE_NAME}=${signSession('admin', SECRET).value}`;
    expect(
      await authenticateHeaders({ authorization: basic('admin', 'wrong'), cookie }, configStub()),
    ).toBeNull();
  });

  it('handles missing config values as unauthenticated', async () => {
    const empty = configStub({ BASIC_AUTH_PASSWORD_HASH: undefined, SESSION_SECRET: undefined });
    expect(
      await authenticateHeaders({ authorization: basic('admin', PASSWORD) }, empty),
    ).toBeNull();
    expect(await authenticateHeaders({ cookie: `${SESSION_COOKIE_NAME}=x.y` }, empty)).toBeNull();
  });
});
