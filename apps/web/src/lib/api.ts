import { apiErrorSchema } from '@trainslator/shared';

/**
 * Thin typed fetch wrapper for the REST API. Same-origin in production;
 * proxied by Vite in development (see vite.config.ts). Credentials are
 * same-origin cookies; 401s surface as a redirect to /login.
 */

export class ApiError extends Error {
  /** Machine-readable message from the API error body when present. */
  readonly apiMessage: string | undefined;
  /** HTTP status code from the server, or 0 when the request never reached it. */
  readonly status: number;

  constructor(status: number, message: string, apiMessage?: string) {
    super(message);
    this.status = status;
    this.apiMessage = apiMessage;
  }
}

/**
 * Performs a request, throwing {@link ApiError} on non-2xx responses.
 * @param path - the request path (relative to the API origin)
 * @param init - fetch overrides (method, headers, body...)
 * @returns the parsed response body
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    throw new ApiError(401, 'Authentication required');
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = null; // body unreadable: fall back to the status text
    }
    const apiMessage = messageOf(body);
    throw new ApiError(response.status, apiMessage ?? response.statusText, apiMessage);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

/**
 * Builds a query string from pagination/search parameters, skipping empties.
 * @param params - the query parameters (undefined and empty string values are skipped)
 * @returns the query string including the leading `?`, or '' when empty
 */
export function toQueryString(
  params: Record<string, boolean | number | string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Extracts the API error message from an error response body, if any.
 * The shared contract is the primary path; a legacy or mixed-version body that
 * fails validation because it omits `statusCode` still surfaces its `message`
 * using the previous string/array extraction. Anything else falls back safely
 * to the caller's status text. The synthetic 401 short-circuits in apiFetch
 * and never reaches this helper.
 * @param body - the parsed response body
 * @returns the message from the body, when one is present
 */
function messageOf(body: unknown): string | undefined {
  const parsed = apiErrorSchema.safeParse(body);
  if (parsed.success) {
    const { message } = parsed.data;
    return Array.isArray(message) ? message.join('; ') : message;
  }
  // Legacy/mixed-version responses may carry only `message` (no statusCode);
  // keep their text visible instead of degrading to a generic status message.
  if (typeof body !== 'object' || body === null || !('message' in body)) return undefined;
  const message: unknown = body.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((part): part is string => typeof part === 'string')) {
    return message.join('; ');
  }
  return undefined;
}
