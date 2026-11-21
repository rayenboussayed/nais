import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  return {
    drizzle: vi.fn(() => ({ kind: 'db' })),
    end,
    migrate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    poolCtor: vi.fn(function () {
      return { end };
    }),
  };
});

vi.mock('pg', () => ({ Pool: mocks.poolCtor }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));
vi.mock('drizzle-orm/node-postgres/migrator', () => ({ migrate: mocks.migrate }));

import { Logger } from '@nestjs/common';

import { main } from './migrate.js';

const DSN = 'postgresql://trainslator:change-me@127.0.0.1:5432/trainslator';

describe('db:migrate main() (in process)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.end.mockResolvedValue(undefined);
    mocks.migrate.mockResolvedValue(undefined);
    vi.stubEnv('DATABASE_URL', DSN);
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
    vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('applies migrations through the migrator and closes the pool on success', async () => {
    await expect(main()).resolves.toBeUndefined();

    expect(mocks.poolCtor).toHaveBeenCalledWith({ connectionString: DSN, max: 1 });
    expect(mocks.drizzle).toHaveBeenCalledWith({ client: { end: mocks.end } });
    expect(mocks.migrate).toHaveBeenCalledWith(
      { kind: 'db' },
      expect.objectContaining({ migrationsFolder: expect.stringMatching(/drizzle$/) }),
    );
    expect(Logger.log).toHaveBeenCalledWith('migrations applied', 'Migrate');
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('closes the pool and propagates a migrator failure', async () => {
    mocks.migrate.mockRejectedValueOnce(new Error('migration failed'));

    await expect(main()).rejects.toThrow('migration failed');

    expect(mocks.migrate).toHaveBeenCalledOnce();
    expect(Logger.log).not.toHaveBeenCalledWith('migrations applied', 'Migrate');
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
