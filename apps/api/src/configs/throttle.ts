import type { ExecutionContext } from '@nestjs/common';

import { HEALTH_PATH } from '../modules/auth/public-path.js';

/**
 * Throttler `skipIf` predicate. The global limiter covers HTTP only:
 * - the WebSocket handshake and every `translate` frame are limited by the
 *   gateway's identity-keyed limiter (and its per-IP handshake backstop);
 * - the health probe answers for orchestrators;
 * - a non-HTTP context has no response to annotate, so the throttler would
 *   crash on it.
 * @param context - the execution context to inspect
 * @returns true when the throttler should skip this context
 */
export function skipHealthProbe(context: ExecutionContext): boolean {
  try {
    if (typeof context.getType === 'function' && context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<{ url?: string }>();
    return request?.url?.startsWith(HEALTH_PATH) ?? false;
  } catch {
    // Unrecognized context shape: fail open for WS-like hosts only when we can
    // tell; otherwise do not skip the limiter.
    return false;
  }
}
