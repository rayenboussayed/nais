import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import type { HealthCheckResult } from '@nestjs/terminus';

/** Liveness/readiness endpoint at `GET /api/health`. */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  /**
   * Terminus liveness result, watched by Docker healthchecks and orchestrators.
   * Subsystem indicators (database) are registered with terminus in their own
   * modules, not in this controller.
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }
}
