import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from '../../db/database-health.indicator.js';
import { DrizzleModule } from '../../db/drizzle.module.js';
import { HealthController } from './health.controller.js';

/** Exposes `/api/health`: liveness plus a real `SELECT 1` against the pool. */
@Module({
  controllers: [HealthController],
  imports: [TerminusModule, DrizzleModule],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
