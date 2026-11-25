import type { FastifyRequest } from 'fastify';

import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '../environment.js';

import { authenticateHeaders } from '../modules/auth/authenticate.js';
import { BasicAuth, isBasicHeader } from '../modules/auth/basic.js';
import { HEALTH_PATH, LOGIN_PATH, normalizePath } from '../modules/auth/public-path.js';

/** Routes that answer without credentials (liveness probe, login). */
const AUTH_ALLOWLIST: ReadonlySet<string> = new Set([HEALTH_PATH, LOGIN_PATH]);

/**
 * HTTP Basic-or-cookie authentication as a Nest guard, registered AFTER the
 * ThrottlerGuard so unauthenticated floods are 429'd before any scrypt work
 * happens. WebSocket contexts pass through (the WS handshake enforces auth
 * itself); the paths in AUTH_ALLOWLIST are public by design.
 */
@Injectable()
export class HttpAuthGuard implements CanActivate {
  private readonly basic: BasicAuth;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.basic = new BasicAuth(config);
  }

  /**
   * @param context - the execution context; only the `http` type is guarded
   * @returns true when the caller may proceed
   * @throws {UnauthorizedException} when the credentials are missing or invalid
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const path = normalizePath(request.url);
    if (AUTH_ALLOWLIST.has(path)) return true;

    if (isBasicHeader(request.headers.authorization)) {
      this.basic.verify(context);
      return true;
    }

    const auth = await authenticateHeaders(request.headers, this.config);
    if (!auth) {
      throw new UnauthorizedException('Unauthorized');
    }
    return true;
  }
}
