import { existsSync } from 'node:fs';
import path from 'node:path';

import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTempCluster, type TempCluster } from './pg-temp.js';

/**
 * End-to-end check of the same bins `npm run db:migrate` / `npm run db:seed`
 * invoke in dev and in the Docker entrypoint: real node child processes
 * against a throwaway cluster. Requires `npm run build` to have run (the
 * root `check` script builds before testing).
 */
describe('database bins (child process)', () => {
  const distDir = path.join(__dirname, '..', 'dist', 'database');
  const binsDir = path.join(__dirname, '..', 'bin');
  const hasBuild =
    existsSync(path.join(distDir, 'migrate.js')) && existsSync(path.join(distDir, 'seed.js'));
  let cluster: TempCluster | undefined;

  beforeAll(() => {
    if (hasBuild) cluster = startTempCluster('trainslator_cli_test');
  }, 90_000);

  afterAll(() => cluster?.destroy());

  it('db:migrate and db:seed run cleanly and idempotently', { timeout: 60_000 }, () => {
    if (!cluster) {
      throw new Error('dist missing: run `npm run build` first');
    }
    const env = { ...process.env, DATABASE_URL: cluster.url(), SESSION_SECRET: 'a'.repeat(64) };

    const migrate = spawnSync(process.execPath, [path.join(binsDir, 'db-migrate.mjs')], {
      env,
      encoding: 'utf8',
    });
    expect(migrate.status, migrate.stderr).toBe(0);

    const seed = spawnSync(process.execPath, [path.join(binsDir, 'db-seed.mjs')], {
      env,
      encoding: 'utf8',
    });
    expect(seed.status, seed.stderr).toBe(0);
    expect(seed.stdout).toContain('languages seed complete: 184 rows upserted');

    const seedAgain = spawnSync(process.execPath, [path.join(binsDir, 'db-seed.mjs')], {
      env,
      encoding: 'utf8',
    });
    expect(seedAgain.status, seedAgain.stderr).toBe(0);
    expect(seedAgain.stdout).toContain('languages seed complete: 184 rows upserted');

    // Failure path: garbage DATABASE_URL must fail the process with a message, not hang.
    const broken = spawnSync(process.execPath, [path.join(binsDir, 'db-seed.mjs')], {
      env: { ...env, DATABASE_URL: 'not a dsn' },
      encoding: 'utf8',
    });
    expect(broken.status).not.toBe(0);
    expect(broken.stderr.length).toBeGreaterThan(0);
  });
});
