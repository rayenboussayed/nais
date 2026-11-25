import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/internal';
import { BasicAuthGuard, SKIP_BASIC_AUTH_KEY } from 'nest-basic-auth';

import type { Env } from '../../environment.js';

import { BASIC_AUTH_REALM } from '../../constants/auth.js';
import { firstHeader } from './authenticate.js';

/**
 * Request shape the package guard mutates when it succeeds.
 */
export interface BasicRequest {
  /** Parsed request body. */
  body: unknown;
  /** Lowercase header map, possibly multi-valued. */
  headers: Record<string, string | string[] | undefined>;
  /** Credentials assigned by the package guard on success. */
  user?: { name: string; pass: string };
}

/**
 * Owns the package guard and the skip metadata check shared by every Basic-auth entry point.
 */
export class BasicAuth {
  private readonly guard: BasicAuthGuard;
  private readonly reflector = new Reflector();

  /**
   * @param config - parsed application env, the only source of accepted credentials
   */
  constructor(config: ConfigService<Env, true>) {
    const name = config.get('AUTH_NAME', { infer: true });
    const pass = config.get('AUTH_PASS', { infer: true });
    this.guard = new BasicAuthGuard({
      body: false,
      credentials: name !== undefined && pass !== undefined ? [{ name, pass }] : [],
      headerNames: { name: '', pass: '' },
      realm: BASIC_AUTH_REALM,
    });
  }

  /**
   * Whether the route opted out with `@SkipBasicAuth()`.
   * @param context - the current execution context
   * @returns true when the handler or controller is public
   */
  isPublic(context: ExecutionContext): boolean {
    const handler = typeof context.getHandler === 'function' ? context.getHandler() : undefined;
    const controller = typeof context.getClass === 'function' ? context.getClass() : undefined;
    const targets = [handler, controller].filter(
      (target) => target !== undefined && target !== null,
    );
    return this.reflector.getAllAndOverride(SKIP_BASIC_AUTH_KEY, targets) === true;
  }

  /**
   * Verifies the request with the package guard.
   * @param context - the current execution context
   * @throws {UnauthorizedException} when the Basic credentials are missing or invalid
   */
  verify(context: ExecutionContext): void {
    this.guard.canActivate(context);
  }
}

/**
 * Builds an HTTP execution context for callers outside Nest, such as Fastify hooks and socket.io.
 * @param request - request-like object with the headers to check
 * @param response - reply-like object, empty when no challenge header can be written
 * @returns a context whose metadata targets are real objects
 */
export function basicContext(request: object, response: object = {}): ExecutionContext {
  return new ExecutionContextHost([request, response], BasicAuth, isBasicHeader);
}

/**
 * Whether a raw Authorization value is a Basic attempt by this repo's strict prefix rule.
 * @param value - the raw header value, possibly multi-valued
 * @returns true when the first value starts with `Basic `
 */
export function isBasicHeader(value: string | string[] | undefined): boolean {
  return firstHeader(value)?.startsWith('Basic ') === true;
}
