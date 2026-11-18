import { existsSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolvePgBin, startTempCluster } from './pg-temp';

describe('resolvePgBin without injection', () => {
  it('resolves a real postgres bin directory on this machine', (context) => {
    if (!existsSync('/usr/lib/postgresql') || readdirSync('/usr/lib/postgresql').length === 0) {
      context.skip();
      return;
    }
    const dir = resolvePgBin();
    expect(existsSync(`${dir}/initdb`)).toBe(true);
  });
});

describe('startTempCluster failure path', () => {
  const originalTimeout = process.env.PG_TEST_TIMEOUT_MS;

  it('throws when postgres never becomes ready within the timeout', () => {
    // A real cluster starts but the probe never answers; no port is opened.
    expect(() => startTempCluster('trainslator_fail_test', () => false, 50)).toThrow(
      /did not start/,
    );
  });

  it('honors PG_TEST_TIMEOUT_MS when no explicit timeout is passed', () => {
    process.env.PG_TEST_TIMEOUT_MS = '50';
    try {
      expect(() => startTempCluster('trainslator_env_timeout_test', () => false)).toThrow(
        /did not start/,
      );
    } finally {
      if (originalTimeout === undefined) delete process.env.PG_TEST_TIMEOUT_MS;
      else process.env.PG_TEST_TIMEOUT_MS = originalTimeout;
    }
  });
});
