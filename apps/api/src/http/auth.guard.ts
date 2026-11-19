import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';
import { authenticateHeaders } from '../auth/authenticate.js';

/** Routes that answer without credentials (liveness probe, login). */
const AUTH_ALLOWLIST = new Set(['/api/health', '/api/auth/login']);

/**
 * HTTP Basic-or-cookie authentication as a Nest guard, registered AFTER the
 * ThrottlerGuard so unauthenticated floods are 429'd before any scrypt work
 * happens. WebSocket contexts pass through (the WS handshake enforces auth
 * itself); /api/health and /api/auth/login are public by design.
 */
@Injectable()
export class HttpAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  /** @returns true when the caller may proceed; @throws UnauthorizedException otherwise */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const path = String(request.url.split('?')[0]).replace(/\/+$/, '');
    if (AUTH_ALLOWLIST.has(path)) return true;

    const auth = await authenticateHeaders(
      request.headers as Record<string, string | string[] | undefined>,
      this.config,
    );
    if (!auth) {
      throw new UnauthorizedException('Unauthorized');
    }
    return true;
  }
}
