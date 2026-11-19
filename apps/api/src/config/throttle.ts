import type { ExecutionContext } from '@nestjs/common';

/**
 * Throttler `skipIf` predicate: never rate-limit the health probe.
 * Probes without an HTTP context are treated as unlimited as well.
 */
export function skipHealthProbe(context: ExecutionContext): boolean {
  try {
    const request = context.switchToHttp().getRequest<{ url?: string }>();
    return request?.url?.startsWith('/api/health') ?? false;
  } catch {
    // No HTTP context or a hostile switchToHttp: do not skip the limiter.
    return false;
  }
}
