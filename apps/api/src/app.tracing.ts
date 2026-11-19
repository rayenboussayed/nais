import { FastifyOtelInstrumentation } from '@fastify/otel';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SocketIoInstrumentation } from '@opentelemetry/instrumentation-socket.io';
import { B3Propagator } from '@opentelemetry/propagator-b3';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';

import type { Env } from './environment.js';

import { validateEnv } from './environment.js';

/**
 * OpenTelemetry wiring for the API (iradable/backend parity): Fastify- and
 * socket.io instrumentation, OTLP/HTTP traces and a Prometheus `/metrics`
 * scrape endpoint. Telemetry is **disabled unless `OTEL_TRACE_EXPORTER_URL`
 * is set** — without that variable the SDK is never constructed, the metrics
 * port is never bound and host-metric observers are never registered.
 *
 * `getOtelSdk` memoizes one instance: the bootstrap starts it before Nest is
 * created, the telemetry module shuts it down on application shutdown so
 * batched spans are flushed before `useProcessExit` exits the process.
 */

let otelSdk: NodeSDK | undefined;
let initialized = false;

/**
 * Builds the Node SDK from the validated environment.
 * @param env - the parsed application environment
 * @returns the configured SDK, or `undefined` when telemetry is disabled
 */
export function createOtelSdk(env: Env): NodeSDK | undefined {
  const endpoint = env.OTEL_TRACE_EXPORTER_URL;
  if (!endpoint) return undefined;

  // Direct use of @opentelemetry/api gives a hook for troubleshooting without
  // production overhead. Enabled only when OTEL_DIAG_ENABLED=true in development.
  if (env.NODE_ENV === 'development' && env.OTEL_DIAG_ENABLED === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  return new NodeSDK({
    contextManager: new AsyncLocalStorageContextManager(),
    instrumentations: [
      getNodeAutoInstrumentations(),
      new FastifyOtelInstrumentation({
        recordExceptions: true,
        registerOnInitialization: true,
      }),
      new SocketIoInstrumentation(),
    ],
    metricReaders: [
      // Bind all interfaces: on a container, localhost-only would make /metrics
      // unreachable to any scraper. Telemetry is opt-in and metrics are not
      // sensitive; publish/scrape only from trusted networks.
      new PrometheusExporter({ host: '0.0.0.0', port: env.OTEL_METRICS_PORT }),
    ],
    resource: defaultResource().merge(
      resourceFromAttributes({
        [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: env.NODE_ENV,
        [ATTR_SERVICE_NAME]: 'trainslator-api',
      }),
    ),
    spanProcessors: [
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: endpoint }) }),
    ],
    textMapPropagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
        new B3Propagator(),
      ],
    }),
  });
}

/**
 * Returns the memoized SDK, building it from `process.env` on first call.
 * @returns the SDK when `OTEL_TRACE_EXPORTER_URL` is set, otherwise `undefined`
 */
export function getOtelSdk(): NodeSDK | undefined {
  if (initialized) return otelSdk;
  initialized = true;
  otelSdk = createOtelSdk(validateEnv(process.env));
  return otelSdk;
}
