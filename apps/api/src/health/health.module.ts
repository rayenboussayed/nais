import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { DatabaseHealthIndicator } from '../database/database-health.indicator.js';
import { DrizzleModule } from '../database/drizzle.module.js';

import { HealthController } from './health.controller.js';

/** Exposes `/api/health`: liveness plus a real `SELECT 1` against the pool. */
@Module({
  imports: [TerminusModule, DrizzleModule],
  controllers: [HealthController],
  providers: [DatabaseHealthIndicator],
})
export class HealthModule {}
