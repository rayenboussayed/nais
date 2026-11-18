import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./seed', () => ({
  seedLanguages: vi.fn().mockResolvedValue({ upserted: 7 }),
}));

import { LanguageSeedService } from './seed.service';
import { seedLanguages } from './seed';
import type { Database } from './drizzle.module';
import type { Env } from '../config/env';

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
