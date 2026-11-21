import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const end = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const returning = vi.fn<() => Promise<Array<{ id: number }>>>().mockResolvedValue([{ id: 1 }]);
  const onConflictDoUpdate = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return {
    drizzle: vi.fn(() => ({ insert })),
    end,
    insert,
    onConflictDoUpdate,
    poolCtor: vi.fn(function () {
      return { end };
    }),
    returning,
    values,
  };
});

vi.mock('pg', () => ({ Pool: mocks.poolCtor }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));

import { Logger } from '@nestjs/common';

import { main } from './seed.js';

const DSN = 'postgresql://trainslator:change-me@127.0.0.1:5432/trainslator';

describe('db:seed main() (in process)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.end.mockResolvedValue(undefined);
    mocks.returning.mockResolvedValue([{ id: 1 }]);
    mocks.drizzle.mockImplementation(() => ({ insert: mocks.insert }));
    vi.stubEnv('DATABASE_URL', DSN);
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(64));
    vi.spyOn(Logger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('upserts every language chunk and closes the pool on success', async () => {
    await expect(main()).resolves.toBeUndefined();

    expect(mocks.poolCtor).toHaveBeenCalledWith({ connectionString: DSN, max: 1 });
    // 184 seed rows at CHUNK 100 => two insert/returning statements.
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.returning).toHaveBeenCalledTimes(2);
    expect(Logger.log).toHaveBeenCalledWith('languages seed complete: 2 rows upserted', 'Seed');
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('closes the pool and propagates an insert failure', async () => {
    mocks.returning.mockRejectedValueOnce(new Error('insert failed'));

    await expect(main()).rejects.toThrow('insert failed');

    expect(mocks.returning).toHaveBeenCalledOnce();
    expect(mocks.end).toHaveBeenCalledOnce();
  });

  it('closes the pool when drizzle initialisation throws', async () => {
    mocks.drizzle.mockImplementationOnce(() => {
      throw new Error('drizzle init failed');
    });

    await expect(main()).rejects.toThrow('drizzle init failed');

    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.end).toHaveBeenCalledOnce();
  });
});
