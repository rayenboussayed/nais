import createClient from 'openapi-fetch';
import { z } from 'zod';

import type { paths } from '../../../../generated/api';

/**
 * Thin typed fetch wrapper for the REST API. Same-origin in production;
 * proxied by Vite in development (see vite.config.ts). Credentials are
 * same-origin cookies; 401s surface as a redirect to /login.
 */

/** Per-call options shared by every typed GET operation in the generated spec. */
type ClientInit = {
  readonly headers?: Headers;
  readonly signal?: AbortSignal | null;
};

/** A typed GET call that resolves once openapi-fetch has issued the request. */
type RouteCaller = (init: ClientInit) => Promise<TypedResult>;

/** The result of a typed GET, with the wire payloads read once by openapi-fetch. */
type TypedResult = { data?: unknown; error?: unknown; response: Response };

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
 * Absolute origin used to build a valid Request in non-browser runtimes (tests).
 * Browsers keep their real origin, so same-origin credentials still apply.
 */
const clientBaseUrl =
  typeof window === 'undefined' ? 'https://api.invalid' : window.location.origin;

/**
 * Performs a request, throwing {@link ApiError} on non-2xx responses.
 * Literal GET paths from the generated spec go through the typed client;
 * every other path falls back to an equivalent plain fetch.
 * @param path - the request path (relative to the API origin)
 * @param init - fetch overrides (method, headers, body...)
 * @returns the parsed response body
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const question = path.indexOf('?');
  const pathname = question === -1 ? path : path.slice(0, question);
  const search = question === -1 ? '' : path.slice(question + 1);
  const method = (init.method ?? 'GET').toUpperCase();

  const clientInit: ClientInit = {
    ...(init.headers === undefined ? {} : { headers: new Headers(init.headers) }),
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  };

  const client = createClient<paths>({
    baseUrl: clientBaseUrl,
    credentials: 'same-origin',
    querySerializer: () => search,
  });

  const typedRoutes: Record<string, RouteCaller> = {
    '/api/ai-messages': (options) => client.GET('/api/ai-messages', options),
    '/api/ai/tasks': (options) => client.GET('/api/ai/tasks', options),
    '/api/health': (options) => client.GET('/api/health', options),
    '/api/languages': (options) => client.GET('/api/languages', options),
    '/api/translations': (options) => client.GET('/api/translations', options),
  };

  const route =
    method === 'GET'
      ? Object.entries(typedRoutes).find(([routePath]) => routePath === pathname)?.[1]
      : undefined;
  if (route === undefined) {
    return handleResponse<T>(
      await fetch(path, {
        ...init,
        credentials: 'same-origin',
        headers: {
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      }),
    );
  }

  const { data, error, response } = await route(clientInit);
  return mapResponse<T>(response, response.ok ? data : error);
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
 * Reads a plain fetch response once, then applies the shared response contract.
 * 401 and 204 need no body; success bodies are JSON by contract and keep their
 * original parse failure, while error bodies may be unreadable.
 * @param response - the response returned by the plain fetch
 * @returns the parsed response body
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 204) {
    return mapResponse<T>(response, undefined);
  }
  if (response.ok) {
    return mapResponse<T>(response, await response.json());
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null; // body unreadable: fall back to the status text
  }
  return mapResponse<T>(response, body);
}

/**
 * Applies the API's response contract to a body the caller has already read:
 * synthetic 401, legacy error bodies, status text and 204-to-undefined. Both
 * request paths call this once with an already-parsed body, so a response is
 * never read twice: the typed path passes openapi-fetch's `data` or `error`,
 * the fallback path passes the single read performed by {@link handleResponse}.
 * @param response - the response returned by the request
 * @param body - the already-parsed wire body: openapi-fetch passes raw text for
 *   error bodies it cannot parse as JSON, while the fallback path passes null
 * @returns the parsed response body
 */
function mapResponse<T>(response: Response, body: unknown): T {
  if (response.status === 401) {
    throw new ApiError(401, 'Authentication required');
  }
  if (!response.ok) {
    const apiMessage = messageOf(body);
    throw new ApiError(response.status, apiMessage ?? response.statusText, apiMessage);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return body as T;
}

/** Shape of the API's shared error envelope, validated at the boundary. */
const errorBodySchema = z.object({
  error: z.string().optional(),
  message: z.union([z.string(), z.array(z.string())]),
  statusCode: z.number().int().min(100).max(599),
});

/**
 * Extracts the API error message from an error response body, if any.
 * The shared contract shape is the primary path; a legacy or mixed-version body
 * that fails validation because it omits `statusCode` still surfaces its `message`
 * using the previous string/array extraction. Anything else falls back safely
 * to the caller's status text. The synthetic 401 short-circuits in mapResponse
 * and never reaches this helper.
 * @param body - the parsed response body
 * @returns the message from the body, when one is present
 */
function messageOf(body: unknown): string | undefined {
  const parsed = errorBodySchema.safeParse(body);
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
