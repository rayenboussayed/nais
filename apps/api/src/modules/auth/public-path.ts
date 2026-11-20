/** The public liveness-probe path. */
export const HEALTH_PATH = '/api/health';

/** The public login path. */
export const LOGIN_PATH = '/api/auth/login';

/**
 * Normalizes a raw request URL for exact-match public-path checks.
 *
 * Strips the query string and every trailing slash. No decoding or other
 * rewriting is performed, so the result is the untouched leading path segment
 * of the input.
 * @param url - the raw request URL
 * @returns the queryless, slash-trimmed path
 */
export function normalizePath(url: string): string {
  const rawPath = String(url.split('?')[0]);
  let pathEnd = rawPath.length;
  while (pathEnd > 0 && rawPath[pathEnd - 1] === '/') pathEnd -= 1;
  return rawPath.slice(0, pathEnd);
}
