/**
 * Decides whether a WebSocket (or browser HTTP) `Origin` may use the API.
 * Same-origin (origin host == request Host header) is always allowed, plus
 * any origin listed in the CORS_ORIGINS env (comma separated). Non-browser
 * clients send no Origin at all and are not cookie-riding threats, so they
 * are allowed.
 *
 * @param origin - value of the Origin header, if any
 * @param host - value of the Host header, if any
 * @param extraOrigins - exact-match origins allowed beyond same-origin (from CORS_ORIGINS)
 */
export function isOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  extraOrigins: readonly string[],
): boolean {
  if (!origin) return true;

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  if (host && parsed.host === host.toLowerCase()) return true;
  return extraOrigins.includes(origin);
}

/** Builds the socket.io `cors` decorator option from CORS_ORIGINS, or undefined when empty. */
export function buildGatewayCors(
  raw: string | undefined,
): { origin: string[]; credentials: boolean } | undefined {
  const origin = parseAllowedOrigins(raw);
  return origin.length > 0 ? { origin, credentials: true } : undefined;
}

/** Static gateway options; the CORS arm flips only at module import, so it is built by a tested function. */
export function buildGatewayOptions(raw: string | undefined): {
  path: string;
  maxHttpBufferSize: number;
  cors?: { origin: string[]; credentials: boolean };
} {
  const cors = buildGatewayCors(raw);
  return {
    path: '/socket.io',
    maxHttpBufferSize: 64 * 1024,
    ...(cors ? { cors } : {}),
  };
}

/** Parses CORS_ORIGINS into a normalized, exact-match allowlist. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
