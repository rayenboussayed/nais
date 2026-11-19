import type { NestFastifyApplication } from '@nestjs/platform-fastify';

import { Logger } from '@nestjs/common';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import type { Env } from './environment.js';

import { AppModule } from './app.module.js';
import { getOtelSdk } from './app.tracing.js';
import { configureApp } from './bootstrap.js';
import { resolveTrustProxy } from './configs/fastify.js';
import { validateEnv } from './environment.js';

/** Wires pipes/filters already registered in modules, starts the HTTP listener and enables shutdown hooks. */
async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  // JSON logs in production (shippers), pretty logs in development.
  const json = env.NODE_ENV === 'production';
  // OpenTelemetry: start before NestFactory so Fastify instrumentation captures bootstrap.
  // No-op unless OTEL_TRACE_EXPORTER_URL is set (see src/app.tracing.ts).
  getOtelSdk()?.start();
  const trustProxy = resolveTrustProxy(env.TRUST_PROXY);
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
  // eslint-disable-next-line n/no-process-exit -- failed bootstrap must kill the process even when pg-boss holds timers
  process.exit(1);
});
