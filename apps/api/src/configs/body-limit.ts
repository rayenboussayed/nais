/**
 * The one route allowed to exceed the process wide request body ceiling.
 * Every other route keeps the global 256 KiB limit configured in main.ts.
 */
export const STT_ROUTE_PATH = '/api/audio/stt';

/**
 * Request body ceiling for {@link STT_ROUTE_PATH}, 8 MiB expressed in bytes.
 * Base64 encoded audio is far larger than the global 256 KiB limit, so the
 * extra allowance is scoped to this route instead of raised process wide.
 */
export const STT_BODY_LIMIT = 8 * 1024 * 1024;

/**
 * The narrow slice of a Fastify route options object this hook needs.
 */
interface SttRouteOptions {
  bodyLimit?: number;
  method?: string | string[];
  url: string;
}

/**
 * Fastify `onRoute` hook that raises the body limit for the STT endpoint only.
 * Fastify supplies `method` either as one verb or as an array, so both shapes
 * are checked. Matching is exact on the path and on POST, which keeps the
 * global 256 KiB limit in force for every other route.
 * @param route - the route options object Fastify passes to `onRoute`
 */
export function setSttBodyLimit(route: SttRouteOptions): void {
  if (route.url !== STT_ROUTE_PATH) return;

  const method = route.method;
  const isPost = Array.isArray(method) ? method.includes('POST') : method === 'POST';
  if (!isPost) return;

  route.bodyLimit = STT_BODY_LIMIT;
}
