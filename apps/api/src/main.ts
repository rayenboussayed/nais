import { Logger } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { resolveTrustProxy } from './config/fastify';
import { validateEnv } from './config/env';
import type { Env } from './config/env';

/** Wires pipes/filters already registered in modules, starts the HTTP listener and enables shutdown hooks. */
async function bootstrap(): Promise<void> {
  // JSON logs in production (shippers), pretty logs in development.
  const json = process.env.NODE_ENV === 'production';
  const trustProxy = resolveTrustProxy(validateEnv(process.env).TRUST_PROXY);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 256 * 1024, trustProxy }),
    { logger: new ConsoleLogger({ json }) },
  );

  await configureApp(app);

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
