import { z } from 'zod';

import { translationNamespaceSchema } from '../schemas/enums.js';

/**
 * Stored timestamptz renders as an ISO datetime, in either `Z` or a numeric
 * offset (e.g. `+00:00`) depending on the driver/serializer; both parse here.
 */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * ISO 639-1 two-letter lowercase language code, e.g. `en`, `fr`, `ar`.
 * Note: only the 184 seeded two-letter codes validate here; BCP-47 tags such
 * as `zh-Hant` are intentionally out of scope for this service.
 */
export const iso6391Schema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}$/, 'Expected a two-letter lowercase ISO 639-1 code');

/**
 * ISO-8601-like cursor timestamps produced from a cast timestamptz column:
 * `2026-11-18T23:05:21.809035+00` (seconds may be absent for sub-second-less
 * precision, offset may omit minutes). Opaque to clients; round-trips
 * through the API as-is.
 */
export const cursorTimestampSchema = z
  .string()
  // eslint-disable-next-line security/detect-unsafe-regex -- fixed-shape ISO 8601: literal separators, bounded quantifiers, no alternation overlap; linear by construction
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/)
  // ±HH (no minutes) is a legal PostgreSQL timestamptz offset literal but not
  // a shape V8's Date parses, so normalize before checking the instant exists.
  .refine(
    (value) => !Number.isNaN(new Date(value.replace(/([+-]\d{2})$/, '$1:00')).getTime()),
    'Expected a real calendar instant',
  );

/** Query-string keyset pagination base, before cross-field constraints. */
export const paginationBaseSchema = z.object({
  /** Anchor row of the previous page (`created_at` half of the `(created_at, id)` keyset; µs-precision from the database). */
  lastCreatedAt: cursorTimestampSchema.optional(),
  /** Anchor row of the previous page (id half of the `(created_at, id)` keyset). */
  lastId: z.uuid().optional(),
  /** Only the boolean tokens listed here parse as true/false; anything else is rejected. */
  onlyDeleted: z
    .stringbool({ falsy: ['false', '0', 'off', 'no'], truthy: ['true', '1', 'on', 'yes'] })
    .default(false),
  orderBy: z.enum(['asc', 'desc']).default('desc'),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Case-insensitive contains match, LIKE-escaped server-side. */
  q: z.string().trim().max(255).optional(),
});

/**
 * Cross-field rule: a cursor is a pair — provide both `lastId` and `lastCreatedAt`, or neither.
 * @param value - the cursor object from the query parser
 * @param value.lastId - the anchor row id, when a cursor is in play
 * @param value.lastCreatedAt - the anchor row timestamp, when a cursor is in play
 * @param ctx - the zod refinement context
 */
export const cursorPairRefine = (
  // eslint-disable-next-line sonarjs/no-redundant-optional -- exactOptionalPropertyTypes requires explicit `| undefined` when callers spread z.infer output into this object
  value: { lastCreatedAt?: string | undefined; lastId?: string | undefined },
  ctx: z.RefinementCtx,
): void => {
  const hasId = value.lastId !== undefined;
  const hasAt = value.lastCreatedAt !== undefined;
  if (hasId !== hasAt) {
    ctx.addIssue({
      code: 'custom',
      message: 'Provide both lastId and lastCreatedAt, or neither',
      path: ['lastId'],
    });
  }
};

/** Query-string keyset pagination and search, shared by the admin list endpoints. */
export const paginationSchema = paginationBaseSchema.superRefine(cursorPairRefine);
/** Validated admin-list query with the cursor-pair rule applied. */
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * A complete `(created_at, id)` keyset cursor as returned by the API: both halves are
 * required. For consumers that already hold a full cursor (e.g. web list state) and
 * need to validate it without the query-string "both or neither" rule of `cursorPairRefine`.
 * Field types mirror `keysetListSchema.next`, so this validates the exact wire shape.
 */
export const keysetCursorSchema = z.object({
  /** Anchor row `created_at` half of the keyset: DB-shaped, µs-precision ISO-8601 timestamp. */
  lastCreatedAt: cursorTimestampSchema,
  /** Anchor row of the previous page (id half of the keyset). */
  lastId: z.uuid(),
});

/** A fully resolved keyset cursor `(lastCreatedAt, lastId)` from the API. */
export type KeysetCursor = z.infer<typeof keysetCursorSchema>;

/** Optional namespace filter, shared by list endpoints. */
export const namespaceFilterSchema = translationNamespaceSchema.optional();

/**
 * Status codes carried by the WebSocket ack frames for both `translate` and `ai`:
 * 200 inline cache hit, 202 queued, 400 malformed request, 404 unknown language/task,
 * 429 rate-limited, 500 backend failure. Single source of truth for both ack contracts.
 */
export const wsAckStatusCodeSchema = z.union([
  z.literal(200),
  z.literal(202),
  z.literal(400),
  z.literal(404),
  z.literal(429),
  z.literal(500),
]);
