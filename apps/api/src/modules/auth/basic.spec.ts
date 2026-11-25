import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { SetMetadata, UnauthorizedException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/internal';
import { SKIP_BASIC_AUTH_KEY } from 'nest-basic-auth';
import { describe, expect, it } from 'vitest';

import type { Env } from '../../environment.js';
import type { BasicRequest } from './basic.js';

import { TEST_BASIC_AUTH_ENV } from '../../../test/auth.js';
import { BASIC_AUTH_REALM } from '../../constants/auth.js';
import { BasicAuth, basicContext, isBasicHeader } from './basic.js';

class HandlerPublicController {
  @SetMetadata(SKIP_BASIC_AUTH_KEY, true)
  openRoute(): void {}
}

@SetMetadata(SKIP_BASIC_AUTH_KEY, true)
class PublicController {
  checkRoute(): void {}

  @SetMetadata(SKIP_BASIC_AUTH_KEY, false)
  protectedRoute(): void {}
}

/**
 * Encodes a Basic header for tests.
 * @param name - username
 * @param pass - password
 * @returns the authorization header value
 */
function basic(name: string, pass: string): string {
  return `Basic ${Buffer.from([name, pass].join(':')).toString('base64')}`;
}

/**
 * Stubs ConfigService with the auth keys under test.
 * @param overrides - env keys to replace
 * @returns the config double
 */
function configStub(overrides: Partial<Record<keyof Env, string | undefined>> = {}) {
  const base: Record<string, string | undefined> = {
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:1/x',
    NODE_ENV: 'development',
    OLLAMA_BASE_URL: 'http://127.0.0.1:1',
    PORT: '3000',
    ...TEST_BASIC_AUTH_ENV,
    ...overrides,
  };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test stub: keys are compile-time constants
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
}

/**
 * Builds a reply double that records the challenge header.
 * @returns the reply and its captured headers
 */
function replyStub() {
  const headers = new Map<string, string>();
  const reply = {
    header: (name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return reply;
    },
  };
  return { headers, reply };
}

describe('isBasicHeader', () => {
  it('accepts only the strict Basic prefix, including array headers', () => {
    expect(isBasicHeader(basic('admin', 'admin-password'))).toBe(true);
    expect(isBasicHeader([basic('admin', 'admin-password'), 'Bearer x'])).toBe(true);
    expect(isBasicHeader(['Bearer x', basic('admin', 'admin-password')])).toBe(false);
    expect(isBasicHeader('basic dXNlcjpwYXNz')).toBe(false);
    expect(isBasicHeader('Bearer x')).toBe(false);
    expect(isBasicHeader(undefined)).toBe(false);
  });
});

describe('basicContext', () => {
  it('supplies real metadata targets outside Nest', () => {
    const context = basicContext({ headers: {} });
    expect(typeof context.getHandler()).toBe('function');
    expect(typeof context.getClass()).toBe('function');
  });
});

describe('BasicAuth', () => {
  it('accepts the configured credential and assigns it to the request', () => {
    const request: BasicRequest = {
      body: {},
      headers: { authorization: basic('admin', 'admin-password') },
    };
    const auth = new BasicAuth(configStub());
    auth.verify(basicContext(request));
    expect(request.user).toEqual({ name: 'admin', pass: 'admin-password' });
  });

  it('ignores the x-auth-header fallback carriers', () => {
    const auth = new BasicAuth(configStub());
    const context = basicContext({
      body: {},
      headers: { 'x-auth-name': 'admin', 'x-auth-pass': 'admin-password' },
    });
    expect(() => auth.verify(context)).toThrow(UnauthorizedException);
  });

  it('rejects a missing password in config even for a matching header name', () => {
    const auth = new BasicAuth(configStub({ AUTH_NAME: 'nobody', AUTH_PASS: undefined }));
    const context = basicContext({
      body: {},
      headers: { authorization: basic('nobody', 'admin-password') },
    });
    expect(() => auth.verify(context)).toThrow(UnauthorizedException);
  });

  it('rejects a missing username in config', () => {
    const auth = new BasicAuth(configStub({ AUTH_NAME: undefined, AUTH_PASS: 'admin-password' }));
    const context = basicContext({
      body: {},
      headers: { authorization: basic('nobody', 'admin-password') },
    });
    expect(() => auth.verify(context)).toThrow(UnauthorizedException);
  });

  it('sets the configured realm on the reply before rejecting', () => {
    const auth = new BasicAuth(configStub());
    const { headers, reply } = replyStub();
    const context = basicContext({ body: {}, headers: {} }, reply);
    expect(() => auth.verify(context)).toThrow(UnauthorizedException);
    expect(headers.get('www-authenticate')).toBe(`Basic realm="${BASIC_AUTH_REALM}"`);
  });

  it('honours skip metadata with handler-level override', () => {
    const auth = new BasicAuth(configStub());
    const controller = new PublicController();
    const publicContext = new ExecutionContextHost(
      [{}, {}],
      PublicController,
      PublicController.prototype.checkRoute,
    );
    expect(auth.isPublic(publicContext)).toBe(true);

    const protectedContext = new ExecutionContextHost(
      [{}, {}],
      PublicController,
      controller.protectedRoute,
    );
    expect(auth.isPublic(protectedContext)).toBe(false);

    const handlerPublic = new ExecutionContextHost(
      [{}, {}],
      HandlerPublicController,
      new HandlerPublicController().openRoute,
    );
    expect(auth.isPublic(handlerPublic)).toBe(true);
  });

  it('treats contexts without usable metadata targets as protected', () => {
    const auth = new BasicAuth(configStub());
    const hostile = {} as unknown as ExecutionContext;
    expect(auth.isPublic(hostile)).toBe(false);
    expect(auth.isPublic(new ExecutionContextHost([{}, {}], null, null))).toBe(false);
  });
});
