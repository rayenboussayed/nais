import { afterEach, describe, expect, it, vi } from 'vitest';

interface FactoryProvider {
  useFactory: (config: unknown) => unknown;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AppModule', () => {
  it('declares the root module with its global filters, pipe and guards', async () => {
    // @nestjs/config loads env at module-decorator time: set valid dummies before import.
    vi.stubEnv('DATABASE_URL', 'postgresql://trainslator:change-me@localhost:5432/trainslator');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));

    const { AppModule } = await import('./app.module.js');
    expect(AppModule).toBeTypeOf('function');

    const imports = Reflect.getMetadata('imports', AppModule) as undefined | unknown[];
    const providers = Reflect.getMetadata('providers', AppModule) as undefined | unknown[];
    expect(Array.isArray(imports)).toBe(true);
    expect(imports?.length).toBeGreaterThan(0);
    expect(Array.isArray(providers)).toBe(true);
    // APP_FILTER, APP_PIPE and two APP_GUARD providers.
    expect(providers).toHaveLength(4);
  });
});

describe('AppModule throttling factory', () => {
  it('builds the throttle options from ConfigService', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://trainslator:change-me@localhost:5432/trainslator');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
    const { AppModule } = await import('./app.module.js');
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
    const dynamic = imports.find((entry) => {
      if (typeof entry !== 'object' || entry === null || !('module' in entry)) return false;
      const module = Reflect.get(entry, 'module');
      return typeof module === 'function' && module.name === 'ThrottlerModule';
    });
    if (typeof dynamic !== 'object' || dynamic === null || !('providers' in dynamic)) {
      throw new Error('ThrottlerModule dynamic metadata missing');
    }
    const providers = Reflect.get(dynamic, 'providers') as unknown[];
    const provider = providers.find(
      (entry): entry is FactoryProvider =>
        typeof entry === 'object' && entry !== null && 'useFactory' in entry,
    );
    if (!provider) throw new Error('throttle factory provider missing');
    const get = vi.fn().mockReturnValue(7);
    expect(provider.useFactory({ get })).toEqual({
      skipIf: expect.any(Function),
      throttlers: [{ limit: 7, ttl: 60_000 }],
    });
    expect(get).toHaveBeenCalledWith('THROTTLE_LIMIT', { infer: true });
  });
});
