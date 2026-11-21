import { afterEach, describe, expect, it, vi } from 'vitest';

interface FactoryProvider {
  useFactory: (config: unknown) => unknown;
}

describe('AiTaskQueueModule pg-boss factory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds pg-boss options from ConfigService', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://trainslator:change-me@localhost:5432/trainslator');
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
    const { AiTaskQueueModule } = await import('./ai-task-queue.module.js');
    const imports = Reflect.getMetadata('imports', AiTaskQueueModule) as unknown[];
    const dynamic = imports.find((entry) => {
      if (typeof entry !== 'object' || entry === null || !('module' in entry)) return false;
      const module = Reflect.get(entry, 'module');
      return typeof module === 'function' && module.name === 'PgBossModule';
    });
    if (typeof dynamic !== 'object' || dynamic === null || !('providers' in dynamic)) {
      throw new Error('PgBossModule dynamic metadata missing');
    }
    const providers = Reflect.get(dynamic, 'providers') as unknown[];
    const provider = providers.find(
      (entry): entry is FactoryProvider =>
        typeof entry === 'object' && entry !== null && 'useFactory' in entry,
    );
    if (!provider) throw new Error('pg-boss factory provider missing');
    const get = vi.fn().mockReturnValue('postgresql://boss');
    expect(provider.useFactory({ get })).toEqual({ connectionString: 'postgresql://boss' });
    expect(get).toHaveBeenCalledWith('PG_BOSS_URL', { infer: true });
  });
});
