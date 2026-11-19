// @vitest-environment jsdom
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const providers: Array<{
  config: unknown;
  forceFlush: ReturnType<typeof vi.fn>;
  registered: unknown;
}> = [];
// eslint-disable-next-line sonarjs/no-clear-text-protocols -- test fixture, not shipped config; the documented local OTLP collector endpoint
const COLLECTOR_URL = 'http://collector.internal:4318';
const registerSpy = vi.fn();
const exporterSpy = vi.fn();
const instrumentationsSpy = vi.fn((): readonly [string] => ['auto-instrumentations']);
const zoneManagerSpy = vi.fn();
const propagatorSpy = vi.fn();

vi.mock('@opentelemetry/sdk-trace-web', () => ({
  BatchSpanProcessor: class BatchSpanProcessor {
    constructor(options: unknown) {
      exporterSpy(options);
    }
  },
  WebTracerProvider: class WebTracerProvider {
    forceFlush = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    constructor(config: unknown) {
      providers.push({ config, forceFlush: this.forceFlush, registered: undefined });
    }
    register(options: unknown): void {
      registerSpy(options);
      const latest = providers.at(-1);
      if (latest) latest.registered = options;
    }
  },
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class OTLPTraceExporter {
    constructor(options: unknown) {
      exporterSpy(options);
    }
  },
}));

vi.mock('@opentelemetry/auto-instrumentations-web', () => ({
  getWebAutoInstrumentations: instrumentationsSpy,
}));

vi.mock('@opentelemetry/context-zone', () => ({
  ZoneContextManager: class ZoneContextManager {
    constructor() {
      zoneManagerSpy();
    }
  },
}));

vi.mock('@opentelemetry/core', () => ({
  W3CTraceContextPropagator: class W3CTraceContextPropagator {
    constructor() {
      propagatorSpy();
    }
  },
}));

vi.mock('@opentelemetry/instrumentation', () => ({
  registerInstrumentations: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  providers.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startTelemetry', () => {
  it('is a no-op when VITE_OTEL_ENDPOINT is unset', async () => {
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();
    expect(providers).toHaveLength(0);
    expect(registerInstrumentations).not.toHaveBeenCalled();
  });

  it('is a no-op when VITE_OTEL_ENDPOINT is blank', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', '   ');
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();
    expect(providers).toHaveLength(0);
    expect(registerInstrumentations).not.toHaveBeenCalled();
  });

  it('starts the provider against the build-time endpoint', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', COLLECTOR_URL);
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();

    expect(providers).toHaveLength(1);
    const provider = providers[0]!;
    const config = provider.config as {
      resource: { attributes: Record<string, unknown> };
      spanProcessors: Array<unknown>;
    };
    expect(config.resource.attributes['service.name']).toBe('trainslator-web');
    expect(config.spanProcessors).toHaveLength(1);
    expect(exporterSpy).toHaveBeenCalledWith({ url: `${COLLECTOR_URL}/v1/traces` });

    // Zone context + W3C propagation; fetch auto-instrumentation registered.
    expect(zoneManagerSpy).toHaveBeenCalledTimes(1);
    expect(propagatorSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerInstrumentations).toHaveBeenCalledWith({
      instrumentations: [['auto-instrumentations']],
    });
  });

  it('is idempotent — a second call starts nothing new', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', COLLECTOR_URL);
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();
    startTelemetry();
    expect(providers).toHaveLength(1);
    expect(registerInstrumentations).toHaveBeenCalledTimes(1);
  });

  it('marks the deployment environment from PROD', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', COLLECTOR_URL);
    vi.stubEnv('PROD', true);
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();

    const config = providers[0]!.config as {
      resource: { attributes: Record<string, unknown> };
    };
    expect(config.resource.attributes['deployment.environment.name']).toBe('production');
  });

  it('does not flush when the tab becomes visible', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', COLLECTOR_URL);
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();

    const count = providers.length;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(providers[count - 1]!.forceFlush).not.toHaveBeenCalled();
  });

  it('force-flushes the provider when the tab hides', async () => {
    vi.stubEnv('VITE_OTEL_ENDPOINT', COLLECTOR_URL);
    const { startTelemetry } = await import('./telemetry');
    startTelemetry();

    const count = providers.length;
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    // All providers started in this file share the event; the new one must flush.
    expect(providers[count - 1]!.forceFlush).toHaveBeenCalledTimes(1);
  });
});
