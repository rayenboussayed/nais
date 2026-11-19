import { Logger } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { IoAdapter } from '@nestjs/platform-socket.io';

import { API_GLOBAL_PREFIX } from './app.constants';
import { AppModule } from './app.module';
import type { Env } from './config/env';

/** Wires pipes/filters already registered in modules, starts the HTTP listener and enables shutdown hooks. */
async function bootstrap(): Promise<void> {
  // JSON logs in production (shippers), pretty logs in development.
  const json = process.env.NODE_ENV === 'production';
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 256 * 1024 }),
    { logger: new ConsoleLogger({ json }) },
  );

  app.useWebSocketAdapter(new IoAdapter(app));

  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  // Run lifecycle hooks (pg-boss stop, pool end), then exit 0 instead of
  // re-raising SIGTERM, which is Nest's default and looks like a crash to supervisors.
  app.enableShutdownHooks(undefined, { useProcessExit: true });

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });

  await app.listen(port, '0.0.0.0');
  Logger.log(`listening on 0.0.0.0:${port}/api`, 'Bootstrap');
}

void bootstrap().catch((error: unknown) => {
  // Nest logs its own boot failure; this adds the fatal line and a non-zero exit.
  const message = error instanceof Error ? error.message : String(error);
  Logger.error(message, 'Bootstrap');
  process.exit(1);
});
