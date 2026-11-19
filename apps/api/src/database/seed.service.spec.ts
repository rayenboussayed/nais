import type { ConfigService } from '@nestjs/config';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./seed', () => ({
  seedLanguages: vi.fn().mockResolvedValue({ upserted: 7 }),
}));

import type { Env } from '../config/env.js';
import type { Database } from './drizzle.module.js';

import { seedLanguages } from './seed.js';
import { LanguageSeedService } from './seed.service.js';

/**
 * Builds the seed service with a stubbed NODE_ENV.
 * @param nodeEnv - the NODE_ENV value to stub
 * @returns the seed service double
 */
function serviceWithNodeEnv(nodeEnv: string) {
  // Test doubles: no Nest container or live database is needed.
  const db = {} as unknown as Database;
  const config = {
    get: (key: string) => (key === 'NODE_ENV' ? nodeEnv : undefined),
  } as unknown as ConfigService<Env, true>;
  return new LanguageSeedService(db, config);
}

describe('LanguageSeedService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the seed under NODE_ENV=test', async () => {
    await expect(serviceWithNodeEnv('test').onApplicationBootstrap()).resolves.toBeUndefined();
    expect(seedLanguages).not.toHaveBeenCalled();
  });

  it('runs the seed outside test and propagates its failure', async () => {
    vi.mocked(seedLanguages).mockRejectedValueOnce(new Error('db down'));
    await expect(serviceWithNodeEnv('development').onApplicationBootstrap()).rejects.toThrow(
      'db down',
    );
  });

  it('logs and resolves on success', async () => {
    await expect(
      serviceWithNodeEnv('development').onApplicationBootstrap(),
    ).resolves.toBeUndefined();
    expect(seedLanguages).toHaveBeenCalledOnce();
  });
});
