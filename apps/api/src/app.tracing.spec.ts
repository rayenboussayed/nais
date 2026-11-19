import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from './environment.js';

import { createOtelSdk } from './app.tracing.js';
import { validateEnv } from './environment.js';

const OTLP_HTTP_URL = 'http://localhost:4318/v1/traces';
const baseEnv: Env = validateEnv({
  DATABASE_URL: 'postgresql://trainslator:change-me@localhost:5432/trainslator',
  NODE_ENV: 'development',
  SESSION_SECRET: 'a'.repeat(64),
});

/** Minimal valid env stub for `validateEnv(process.env)` inside the SDK factory. */
const stubMinimalEnv = (): void => {
  vi.stubEnv('DATABASE_URL', 'postgresql://trainslator:change-me@localhost:5432/trainslator');
  vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createOtelSdk', () => {
  it('returns undefined when OTEL_TRACE_EXPORTER_URL is not set', () => {
    expect(createOtelSdk(baseEnv)).toBeUndefined();
  });

  it('builds a Node SDK when OTEL_TRACE_EXPORTER_URL is set', () => {
    const sdk = createOtelSdk({
      ...baseEnv,
      // Port 0: the Prometheus exporter binds at construction; keep it ephemeral.
      OTEL_METRICS_PORT: 0,
      OTEL_TRACE_EXPORTER_URL: OTLP_HTTP_URL,
    });
    expect(sdk).toBeDefined();
  });

  it('enables diagnostics when OTEL_DIAG_ENABLED=true in development', () => {
    const sdk = createOtelSdk({
      ...baseEnv,
      OTEL_DIAG_ENABLED: 'true',
      OTEL_METRICS_PORT: 0,
      OTEL_TRACE_EXPORTER_URL: OTLP_HTTP_URL,
    });
    expect(sdk).toBeDefined();
  });
});

describe('getOtelSdk', () => {
  it('is disabled by default and returns undefined', async () => {
    vi.resetModules();
    stubMinimalEnv();
    const mod = await import('./app.tracing.js');
    expect(mod.getOtelSdk()).toBeUndefined();
  });

  it('memoizes a single SDK instance built from process.env', async () => {
    vi.resetModules();
    stubMinimalEnv();
    vi.stubEnv('OTEL_TRACE_EXPORTER_URL', OTLP_HTTP_URL);
    vi.stubEnv('OTEL_METRICS_PORT', '18889');
    const mod = await import('./app.tracing.js');
    const first = mod.getOtelSdk();
    expect(first).toBeDefined();
    // Unsetting the variable afterwards must not change the memoized instance.
    vi.stubEnv('OTEL_TRACE_EXPORTER_URL', '');
    expect(mod.getOtelSdk()).toBe(first);
  });
});
