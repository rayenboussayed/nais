/**
 * Thin typed fetch wrapper for the REST API. Same-origin in production;
 * proxied by Vite in development (see vite.config.ts). Credentials are
 * same-origin cookies; 401s surface as a redirect to /login.
 */

/** The API error envelope: message may be a single string or an array of them. */
interface ApiErrorBody {
  message?: string | string[];
}

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
 * @param body - the parsed response body
 * @returns the message when the body carries one
 */
function messageOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const candidate = (body as ApiErrorBody).message;
  if (typeof candidate === 'string') return candidate;
  if (Array.isArray(candidate)) return candidate.join('; ');
  return undefined;
}
