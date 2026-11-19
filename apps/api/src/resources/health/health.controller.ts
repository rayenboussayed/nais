import type { HealthCheckResult } from '@nestjs/terminus';

import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from '../../db/database-health.indicator.js';

/** Liveness and readiness endpoint at `GET /api/health`. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  /**
   * Terminus readiness result. The database probe is the only external
   * dependency the service has; when it fails, Docker/orchestrators get a 503
   * instead of traffic routed to a hollow instance.
   * @returns the readiness result
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([this.database.isHealthy('database')]);
  }
}
