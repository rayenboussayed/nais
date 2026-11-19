import type { HealthCheckAttempt } from '@nestjs/terminus';

import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { sql } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';

import type { Database } from './drizzle.module.js';

import { DRIZZLE } from './drizzle.module.js';

/**
 * Terminus indicator: `SELECT 1` with a measured round-trip against the
 * pool. Failures surface as `down` with a constant `message` — no database
 * error text reaches the response.
 */
@Injectable()
export class DatabaseHealthIndicator {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /**
   * @param key - label in the terminus details payload
   * @returns the terminus attempt, resolved by the health check service
   */
  isHealthy(key: string): HealthCheckAttempt<typeof key> {
    return this.healthIndicatorService
      .check(key)
      .attempt(async () => {
        const start = performance.now();
        await this.db.execute(sql`select 1`);
        return Math.round(performance.now() - start);
      })
      .withSuccessData((latencyMs) => ({ latencyMs }))
      .withFailureData({ message: 'unreachable' })
      .withTimeout('5s');
  }
}
