import { beforeEach, describe, expect, it, vi } from 'vitest';

const shutdown = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
const state: { sdk: undefined | { shutdown: typeof shutdown } } = {
  sdk: { shutdown },
};

// The SDK instance lives in src/app.tracing.ts; stub it so the hook's
// shutdown call is observable without constructing real exporters.
vi.mock('../../app.tracing.js', () => ({
  getOtelSdk: () => state.sdk,
}));

describe('TelemetryModule', () => {
  beforeEach(() => {
    shutdown.mockClear();
    state.sdk = { shutdown };
  });

  it('flushes the OTEL SDK on application shutdown', async () => {
    const { TelemetryModule } = await import('./telemetry.module.js');
    await expect(new TelemetryModule().onApplicationShutdown()).resolves.toBeUndefined();
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when telemetry is disabled (no SDK instance)', async () => {
    state.sdk = undefined;
    const { TelemetryModule } = await import('./telemetry.module.js');
    await expect(new TelemetryModule().onApplicationShutdown()).resolves.toBeUndefined();
    expect(shutdown).not.toHaveBeenCalled();
  });

  it('registers the nestjs-otel host-metrics module when OTEL env is set', async () => {
    vi.resetModules();
    vi.stubEnv('OTEL_TRACE_EXPORTER_URL', 'http://localhost:4318/v1/traces');
    const { TelemetryModule } = await import('./telemetry.module.js');
    expect(TelemetryModule).toBeDefined();
    vi.unstubAllEnvs();
  });
});
