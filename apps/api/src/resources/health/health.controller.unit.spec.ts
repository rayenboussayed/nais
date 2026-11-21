import type { HealthCheckService } from '@nestjs/terminus';

import { describe, expect, it, vi } from 'vitest';

import type { DatabaseHealthIndicator } from '../../db/database-health.indicator.js';

import { HealthController } from './health.controller.js';

/**
 * Builds a controller with isolated collaborators and a canned readiness result.
 * @param result - the terminus result `check` should resolve to
 * @returns the controller plus its collaborator spies
 */
function makeController(result: unknown) {
  const check = vi.fn().mockResolvedValue(result);
  const isHealthy = vi.fn().mockReturnValue('database-attempt');
  const controller = new HealthController(
    { check } as unknown as HealthCheckService,
    { isHealthy } as unknown as DatabaseHealthIndicator,
  );
  return { check, controller, isHealthy };
}

describe('HealthController', () => {
  it('returns the readiness result after probing the database once', async () => {
    const result = { details: { database: { latencyMs: 3, status: 'up' } }, status: 'ok' };
    const { check, controller, isHealthy } = makeController(result);

    await expect(controller.check()).resolves.toBe(result);
    expect(isHealthy).toHaveBeenCalledOnce();
    expect(isHealthy).toHaveBeenCalledWith('database');
    expect(check).toHaveBeenCalledWith(['database-attempt']);
  });

  it('surfaces a failed terminus result unchanged', async () => {
    const result = {
      details: { database: { message: 'unreachable', status: 'down' } },
      status: 'error',
    };
    const { check, controller, isHealthy } = makeController(result);

    await expect(controller.check()).resolves.toBe(result);
    expect(check).toHaveBeenCalledOnce();
    expect(isHealthy).toHaveBeenCalledWith('database');
  });
});
