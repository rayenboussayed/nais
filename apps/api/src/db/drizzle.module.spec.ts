import type { Pool } from 'pg';

import { HealthIndicatorService, HealthIndicatorStatus } from '@nestjs/terminus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn((opts: unknown) => ({ opts })),
  end: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  poolCtor: vi.fn(function (opts: unknown) {
    return { opts };
  }),
}));

vi.mock('pg', () => ({ Pool: mocks.poolCtor }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));

import type { Database } from './drizzle.module.js';

import { DatabaseHealthIndicator } from './database-health.indicator.js';
import { DrizzleModule } from './drizzle.module.js';

interface FactoryProvider {
  useFactory: (...args: unknown[]) => unknown;
}

const DSN = 'postgresql://trainslator:change-me@127.0.0.1:5432/trainslator';

/**
 * Reads the provider factories straight off the module metadata. This needs
 * neither a Nest container nor a live database — only the decorators' output.
 * @returns the PG_POOL and DRIZZLE factory providers, in declaration order
 */
function factories(): FactoryProvider[] {
  const providers = Reflect.getMetadata('providers', DrizzleModule) as
    FactoryProvider[] | undefined;
  if (!providers) throw new Error('DrizzleModule has no providers metadata');
  return providers;
}

describe('DrizzleModule factories (no live database)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds the pg pool from DATABASE_URL with max 10', () => {
    const [poolProvider] = factories();
    const get = vi.fn().mockReturnValue(DSN);

    const result = poolProvider?.useFactory({ get });

    expect(get).toHaveBeenCalledWith('DATABASE_URL', { infer: true });
    expect(mocks.poolCtor).toHaveBeenCalledWith({ connectionString: DSN, max: 10 });
    expect(result).toEqual({ opts: { connectionString: DSN, max: 10 } });
  });

  it('builds the drizzle database over the injected pool', () => {
    const [, drizzleProvider] = factories();
    const pool = { marker: 'pool' };

    const result = drizzleProvider?.useFactory(pool);

    expect(mocks.drizzle).toHaveBeenCalledWith({ client: pool });
    expect(result).toEqual({ opts: { client: pool } });
  });

  it('closes the injected pool on module destroy', async () => {
    const module = new DrizzleModule({ end: mocks.end } as unknown as Pool);

    await expect(module.onModuleDestroy()).resolves.toBeUndefined();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});

describe('DatabaseHealthIndicator (no live database)', () => {
  /**
   * Builds the indicator with a stubbed drizzle executor and a real terminus
   * helper (a pure builder), so success/failure results are observable offline.
   * @param execute - the stub for `db.execute`
   * @returns the indicator under test
   */
  function indicatorWith(execute: () => Promise<unknown>) {
    return new DatabaseHealthIndicator(
      { execute } as unknown as Database,
      new HealthIndicatorService(),
    );
  }

  it('reports up with a measured latency on a successful SELECT 1', async () => {
    const execute = vi.fn<() => Promise<unknown>>().mockResolvedValue(undefined);
    const result = await indicatorWith(execute).isHealthy('database');

    expect(execute).toHaveBeenCalledOnce();
    expect(result.database?.status).toBe(HealthIndicatorStatus.UP);
    expect(result.database).toMatchObject({ latencyMs: expect.any(Number) });
  });

  it('reports down with a constant message and hides DB internals on failure', async () => {
    const execute = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValue(new Error('super-secret-dsn-with-password'));
    const result = await indicatorWith(execute).isHealthy('database');

    expect(execute).toHaveBeenCalledOnce();
    expect(result.database?.status).toBe(HealthIndicatorStatus.DOWN);
    expect(result.database).toMatchObject({ message: 'unreachable' });
    expect(JSON.stringify(result)).not.toContain('super-secret-dsn-with-password');
  });
});
