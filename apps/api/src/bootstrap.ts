import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';
import fastifyHelmet from '@fastify/helmet';
import { ConfigService } from '@nestjs/config';

import { API_GLOBAL_PREFIX } from './app.constants';
import { registerHttpGuards } from './http/request-guards';
import { setupSwagger } from './swagger';
import type { Env } from './config/env';

/**
 * Wires the production HTTP surface onto a created Nest application: helmet
 * CSP, global prefix, WebSocket adapter, the origin backstop hook, Swagger
 * and shutdown hooks. Shared verbatim by the bootstrap and integration
 * specs so both paths answer identically.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
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
