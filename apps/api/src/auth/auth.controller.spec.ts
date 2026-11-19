import type { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env';

import { SESSION_COOKIE_NAME } from './session';
import { AuthController } from './auth.controller';

const HASH = 'scrypt$1024$8$1$' + 'ab'.repeat(16) + '$' + 'cd'.repeat(64);

/** Minimal pass-through reply double; the assertions only inspect header(). */
function replyStub() {
  const headers = new Map<string, string>();
  const reply = {
    header: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return reply;
    }),
  } as unknown as FastifyReply;
  return { reply, headers };
}

function configStub(overrides: Partial<Record<keyof Env, string | undefined>> = {}) {
  const base: Record<string, string | undefined> = {
    BASIC_AUTH_USERNAME: 'admin',
    BASIC_AUTH_PASSWORD_HASH: HASH,
    SESSION_SECRET: 'a'.repeat(64),
    NODE_ENV: 'development',
    ...overrides,
  };
  const config = {
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
  return config;
}

describe('AuthController.login', () => {
  it('issues the cookie for the configured username in development (no Secure flag)', async () => {
    // The hash must verify: sign a real scrypt hash of "admin-password".
    const { scryptSync, randomBytes } = await import('node:crypto');
    const salt = randomBytes(16);
    const hash = `scrypt$1024$8$1$${salt.toString('hex')}$${scryptSync('admin-password', salt, 64, { N: 1024, r: 8, p: 1 }).toString('hex')}`;

    const { reply, headers } = replyStub();
    const controller = new AuthController(configStub({ BASIC_AUTH_PASSWORD_HASH: hash }));

    const result = await controller.login(
      { username: 'admin', password: 'admin-password' },
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
      configStub({ SESSION_SECRET: undefined, BASIC_AUTH_PASSWORD_HASH: HASH }),
    );

    await expect(
      controller.login({ username: 'admin', password: 'whatever' }, '203.0.113.10', reply),
    ).rejects.toThrow('Service unavailable');
  });

  it('rejects when no password hash is configured', async () => {
    const { reply } = replyStub();
    const controller = new AuthController(configStub({ BASIC_AUTH_PASSWORD_HASH: undefined }));

    await expect(
      controller.login({ username: 'admin', password: 'whatever' }, '203.0.113.11', reply),
    ).rejects.toThrow('Invalid credentials');
  });

  it('clears the cookie with Secure in production so it actually matches the login cookie', () => {
    const { reply, headers } = replyStub();
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
        controller.login({ username: 'admin', password: 'wrong' }, '203.0.113.12', reply),
      ).rejects.toThrow('Invalid credentials');
    }
    await expect(
      controller.login({ username: 'admin', password: 'wrong' }, '203.0.113.12', reply),
    ).rejects.toThrow('Too many login attempts');
  });
});
