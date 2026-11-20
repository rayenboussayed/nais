import type { OnApplicationShutdown } from '@nestjs/common';

import { Module } from '@nestjs/common';
import { OpenTelemetryModule } from 'nestjs-otel';

import { getOtelSdk } from '../../app.tracing.js';
import { importTimeEnv } from '../../resources/ai/pipeline-loader.js';

/**
 * Binds host metrics (CPU, memory, event loop) to the global meter provider
 * via nestjs-otel — but only when `OTEL_TRACE_EXPORTER_URL` is set, matching
 * the rest of the telemetry surface: no env, no OpenTelemetry anywhere in
 * the module graph, zero observers.
 */
const otelImports =
  importTimeEnv('OTEL_TRACE_EXPORTER_URL').trim().length > 0
    ? [OpenTelemetryModule.forRoot({ metrics: { hostMetrics: true } })]
    : [];

/**
 * Telemetry root module. Registers the nestjs-otel host-metrics module when
 * telemetry is enabled and flushes the SDK on shutdown so batched spans are
 * exported before `useProcessExit` terminates the process.
 */
@Module({
  imports: otelImports,
})
export class TelemetryModule implements OnApplicationShutdown {
  /** Shuts the memoized OTEL SDK down, flushing pending spans; a no-op when telemetry is disabled. */
  async onApplicationShutdown(): Promise<void> {
    await getOtelSdk()?.shutdown();
  }
}
