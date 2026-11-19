import { getWebAutoInstrumentations } from '@opentelemetry/auto-instrumentations-web';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions';

/**
 * Browser OpenTelemetry for the SPA, modeled on iradable/frontend's web
 * telemetry: `fetch` is auto-instrumented, spans are exported over OTLP/HTTP
 * and flushed when the tab hides. Telemetry is **enabled only when
 * `VITE_OTEL_ENDPOINT` is set at build time** (the OTLP/HTTP base URL, e.g.
 * `http://localhost:4318`) — without it the provider is never created and
 * zero telemetry code runs. No jutilities dependency; kept dependency-light
 * and explicit.
 */

const SERVICE_NAME = 'trainslator-web';

/**
 * Reads the build-time OTEL endpoint exposed by Vite.
 * @returns the trimmed endpoint, or `undefined` when unset or blank
 */
function endpoint(): string | undefined {
  const value: unknown = import.meta.env.VITE_OTEL_ENDPOINT;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

let started = false;

/**
 * Starts browser OpenTelemetry once and flushes on tab hide. Idempotent;
 * a no-op when `VITE_OTEL_ENDPOINT` is unset at build time.
 */
export function startTelemetry(): void {
  if (started) return;
  const otlpEndpoint = endpoint();
  if (!otlpEndpoint) return;
  started = true;

  const resource = resourceFromAttributes({
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: import.meta.env.PROD ? 'production' : 'development',
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
  });

  const provider = new WebTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })),
    ],
  });

  provider.register({
    // ZoneContextManager keeps trace context correct across async boundaries
    // (promises, setTimeout) so child spans attach to the right parent.
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });

  registerInstrumentations({
    instrumentations: [getWebAutoInstrumentations()],
  });

  // Flush on tab close / navigation away — browsers don't reliably let async
  // work finish in `beforeunload`, so use `visibilitychange`.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void provider.forceFlush();
    }
  });
}
