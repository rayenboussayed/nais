import { apiFetch } from './api';

/**
 * Session probe with a short cache. The session cookie is HttpOnly, so the
 * only way to know whether the visitor is signed in is to ask the API.
 * Success is cached for 60s (health checks are cheap); failure for 10s so a
 * fresh login is not shadowed by a stale negative.
 */

const SESSION_TTL_OK = 60_000;
const SESSION_TTL_FAIL = 10_000;

let probe: null | { expires: number; ok: boolean } = null;

/**
 * Session probe with a short cache.
 * @returns true when the visitor appears signed in
 */
export async function hasSession(): Promise<boolean> {
  if (probe && probe.expires > Date.now()) return probe.ok;

  try {
    await apiFetch('/api/languages?pageSize=1');
    probe = { expires: Date.now() + SESSION_TTL_OK, ok: true };
    return true;
  } catch {
    probe = { expires: Date.now() + SESSION_TTL_FAIL, ok: false };
    return false;
  }
}

/** Drops the cached probe after login/logout so the next navigation re-checks. */
export function invalidateSessionProbe(): void {
  probe = null;
}
