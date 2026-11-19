import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';

import type { Env } from './config/env.js';

import { API_GLOBAL_PREFIX } from './app.constants.js';
import { registerHttpGuards } from './http/request-guards.js';
import { setupSwagger } from './swagger.js';

/**
 * Wires the production HTTP surface onto a created Nest application: helmet
 * CSP, global prefix, WebSocket adapter, the origin backstop hook, Swagger
 * and shutdown hooks. Shared verbatim by the bootstrap and integration
 * specs so both paths answer identically.
 * @param app - the created Nest application to configure in place
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
      },
    },
  });

  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix(API_GLOBAL_PREFIX);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  registerHttpGuards(app.getHttpAdapter().getInstance(), config);
  setupSwagger(app);

  app.enableShutdownHooks(undefined, { useProcessExit: true });
}
