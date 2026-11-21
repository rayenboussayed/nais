import type { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';

import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../../environment.js';

import { SESSION_COOKIE_NAME } from '../../modules/auth/session.js';
import { AuthController } from './auth.controller.js';

const HASH = 'scrypt$1024$8$1$' + 'ab'.repeat(16) + '$' + 'cd'.repeat(64);

/**
 * Stubs ConfigService with the keys the unit under test reads.
 * @param overrides - env keys to override in the stubbed parsed config
 * @returns the ConfigService double
 */
function configStub(overrides: Partial<Record<keyof Env, string | undefined>> = {}) {
  const base: Record<string, string | undefined> = {
    BASIC_AUTH_PASSWORD_HASH: HASH,
    BASIC_AUTH_USERNAME: 'admin',
    NODE_ENV: 'development',
    SESSION_SECRET: 'a'.repeat(64),
    ...overrides,
  };
  const config = {
    // eslint-disable-next-line security/detect-object-injection -- test stub: config keys are compile-time constants of the stub
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
  return config;
}

/**
 * Minimal pass-through reply double; the assertions only inspect header().
 * @returns the reply double and the captured headers map
 */
function replyStub() {
  const headers = new Map<string, string>();
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return reply;
    }),
  } as unknown as FastifyReply;
  return { headers, reply };
}

/**
 * Builds a real scrypt hash fixture for "admin-password".
 * @returns a verifiable stored-hash string
 */
async function validPasswordHash(): Promise<string> {
  const { randomBytes, scryptSync } = await import('node:crypto');
  const salt = randomBytes(16);
  const derived = scryptSync('admin-password', salt, 64, { N: 1024, p: 1, r: 8 });
  return `scrypt$1024$8$1$${salt.toString('hex')}$${derived.toString('hex')}`;
}

describe('AuthController.login', () => {
  it('issues the cookie for the configured username in development (no Secure flag)', async () => {
    // The hash must verify: sign a real scrypt hash of "admin-password".
    const hash = await validPasswordHash();

    const { headers, reply } = replyStub();
    const controller = new AuthController(configStub({ BASIC_AUTH_PASSWORD_HASH: hash }));

    const result = await controller.login(
      { password: 'admin-password', username: 'admin' },
      '203.0.113.9',
      reply,
    );
    expect(result).toEqual({ username: 'admin' });
    expect(headers.get('set-cookie')).toContain(SESSION_COOKIE_NAME);
    expect(headers.get('set-cookie')).toContain('SameSite=Lax');
    expect(headers.get('set-cookie')).not.toContain('Secure');
  });

  it('refuses to sign a session when SESSION_SECRET is not configured', async () => {
    const { reply } = replyStub();
    const controller = new AuthController(
      configStub({ BASIC_AUTH_PASSWORD_HASH: HASH, SESSION_SECRET: undefined }),
    );

    await expect(
      controller.login({ password: 'whatever', username: 'admin' }, '203.0.113.10', reply),
    ).rejects.toThrow('Service unavailable');
  });

  it('rejects when no password hash is configured', async () => {
    const { reply } = replyStub();
    const controller = new AuthController(configStub({ BASIC_AUTH_PASSWORD_HASH: undefined }));

    await expect(
      controller.login({ password: 'whatever', username: 'admin' }, '203.0.113.11', reply),
    ).rejects.toThrow('Invalid credentials');
  });

  it('sets Secure on the login cookie in production', async () => {
    const hash = await validPasswordHash();
    const { headers, reply } = replyStub();
    const controller = new AuthController(
      configStub({ BASIC_AUTH_PASSWORD_HASH: hash, NODE_ENV: 'production' }),
    );

    const result = await controller.login(
      { password: 'admin-password', username: 'admin' },
      '203.0.113.20',
      reply,
    );

    expect(result).toEqual({ username: 'admin' });
    expect(headers.get('set-cookie')).toContain('; Secure');
  });

  it('rejects a correct password for an unknown username with the constant 401', async () => {
    const hash = await validPasswordHash();
    const { reply } = replyStub();
    const controller = new AuthController(configStub({ BASIC_AUTH_PASSWORD_HASH: hash }));

    await expect(
      controller.login({ password: 'admin-password', username: 'other' }, '203.0.113.21', reply),
    ).rejects.toThrow('Invalid credentials');
  });

  it('clears the cookie with Secure in production so it actually matches the login cookie', () => {
    const { headers, reply } = replyStub();
    const controller = new AuthController(configStub({ NODE_ENV: 'production' }));

    controller.logout(reply);

    expect(headers.get('set-cookie')).toContain('Secure');
    expect(headers.get('set-cookie')).toContain('Max-Age=0');
  });

  it('limits repeated failures to five attempts per minute per client', async () => {
    const { reply } = replyStub();
    const controller = new AuthController(configStub({ BASIC_AUTH_PASSWORD_HASH: HASH }));

    for (let i = 0; i < 5; i += 1) {
      await expect(
        controller.login({ password: 'wrong', username: 'admin' }, '203.0.113.12', reply),
      ).rejects.toThrow('Invalid credentials');
    }
    await expect(
      controller.login({ password: 'wrong', username: 'admin' }, '203.0.113.12', reply),
    ).rejects.toThrow('Too many login attempts');
  });
});

describe('AuthController.logout', () => {
  it('clears the cookie without Secure outside production', () => {
    const { headers, reply } = replyStub();
    const controller = new AuthController(configStub());

    controller.logout(reply);

    expect(headers.get('set-cookie')).toContain('Max-Age=0');
    expect(headers.get('set-cookie')).not.toContain('Secure');
  });
});
