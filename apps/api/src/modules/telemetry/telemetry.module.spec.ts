import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMock = vi.hoisted(() => ({
  forRoot: vi.fn(() => ({ module: class MockOtelModule {} })),
  getOtelSdk: vi.fn(),
  shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

const state: { sdk: undefined | { shutdown: typeof telemetryMock.shutdown } } = {
  sdk: { shutdown: telemetryMock.shutdown },
};

// The SDK instance lives in src/app.tracing.ts; stub it so the hook's
// shutdown call is observable without constructing real exporters. The
// nestjs-otel stub makes the import-time gate observable via `forRoot`.
vi.mock('../../app.tracing.js', () => ({
  getOtelSdk: () => {
    telemetryMock.getOtelSdk();
    return state.sdk;
  },
}));
vi.mock('nestjs-otel', () => ({
  OpenTelemetryModule: { forRoot: telemetryMock.forRoot },
}));

describe('TelemetryModule', () => {
  beforeEach(() => {
    telemetryMock.shutdown.mockClear();
    telemetryMock.getOtelSdk.mockClear();
    telemetryMock.forRoot.mockClear();
    state.sdk = { shutdown: telemetryMock.shutdown };
    vi.stubEnv('OTEL_TRACE_EXPORTER_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('flushes the OTEL SDK on application shutdown', async () => {
    const { TelemetryModule } = await import('./telemetry.module.js');
    await expect(new TelemetryModule().onApplicationShutdown()).resolves.toBeUndefined();
    expect(telemetryMock.shutdown).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when telemetry is disabled (no SDK instance)', async () => {
    state.sdk = undefined;
    const { TelemetryModule } = await import('./telemetry.module.js');
    await expect(new TelemetryModule().onApplicationShutdown()).resolves.toBeUndefined();
    expect(telemetryMock.shutdown).not.toHaveBeenCalled();
  });

  it('stays a no-op at import when OTEL_TRACE_EXPORTER_URL is unset', async () => {
    vi.resetModules();
    const { TelemetryModule } = await import('./telemetry.module.js');
    expect(telemetryMock.forRoot).not.toHaveBeenCalled();
    expect(telemetryMock.getOtelSdk).not.toHaveBeenCalled();
    expect(TelemetryModule).toBeDefined();
  });

  it('registers the nestjs-otel host-metrics module when OTEL env is set', async () => {
    vi.resetModules();
    vi.stubEnv('OTEL_TRACE_EXPORTER_URL', 'http://localhost:4318/v1/traces');
    const { TelemetryModule } = await import('./telemetry.module.js');
    expect(telemetryMock.forRoot).toHaveBeenCalledWith({ metrics: { hostMetrics: true } });
    expect(telemetryMock.getOtelSdk).not.toHaveBeenCalled();
    expect(TelemetryModule).toBeDefined();
  });
});
