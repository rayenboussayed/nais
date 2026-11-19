import type { ConfigService } from '@nestjs/config';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';
import { authenticateHeaders, firstHeader } from '../auth/authenticate.js';
import { isOriginAllowed, parseAllowedOrigins } from '../auth/origin.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Origin backstop for browser-initiated mutations: any POST/PUT/PATCH/DELETE
 * carrying an `Origin` header must be same-origin (origin host == Host header)
 * or explicitly allowlisted in CORS_ORIGINS. Requests without an `Origin`
 * (curl, server-to-server) pass by design. Enforced before authentication so
 * cross-site forms are rejected without doing any credential work.
 *
 * Authentication itself lives in the Nest `HttpAuthGuard`, registered after
 * the throttler (see app.module.ts).
 */
export function registerHttpGuards(
  fastify: FastifyInstance,
  config: ConfigService<Env, true>,
): void {
  const allowedOrigins = parseAllowedOrigins(config.get('CORS_ORIGINS', { infer: true }));

  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!MUTATING_METHODS.has(request.method)) return;

    const origin = firstHeader(request.headers.origin);
    const host = firstHeader(request.headers.host);
    if (!isOriginAllowed(origin, host, allowedOrigins)) {
      await reply.code(403).send({ statusCode: 403, message: 'Forbidden origin' });
      return;
    }
  });

  // Swagger UI and the JSON document are registered at Fastify level and do
  // NOT pass through Nest guards. They get the same Basic-or-cookie check.
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const path = String(request.url.split('?')[0]);
    if (!path.startsWith('/api/docs')) return;

    const auth = await authenticateHeaders(request.headers, config);
    if (!auth) {
      await reply
        .code(401)
        .header('WWW-Authenticate', 'Basic realm="trainslator"')
        .send({ statusCode: 401, message: 'Unauthorized' });
      return;
    }
  });
}
