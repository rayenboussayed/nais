import { z } from 'zod';

import { translationNamespaceSchema } from './enums';

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
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(?:Z|[+-]\d{2}(?::\d{2})?)$/)
  // ±HH (no minutes) is a legal PostgreSQL timestamptz offset literal but not
  // a shape V8's Date parses, so normalize before checking the instant exists.
  .refine(
    (value) => !Number.isNaN(new Date(value.replace(/([+-]\d{2})$/, '$1:00')).getTime()),
    'Expected a real calendar instant',
  );

/** Query-string keyset pagination and search, shared by the admin list endpoints. */
export const paginationSchema = z
  .object({
    /** Case-insensitive contains match, LIKE-escaped server-side. */
    q: z.string().trim().max(255).optional(),
    /** Anchor row of the previous page (id half of the `(created_at, id)` keyset). */
    lastId: z.uuid().optional(),
    /** Anchor row of the previous page (`created_at` half of the `(created_at, id)` keyset; µs-precision from the database). */
    lastCreatedAt: cursorTimestampSchema.optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    orderBy: z.enum(['asc', 'desc']).default('desc'),
    /** Only the boolean tokens listed here parse as true/false; anything else is rejected. */
    onlyDeleted: z
      .stringbool({ truthy: ['true', '1', 'on', 'yes'], falsy: ['false', '0', 'off', 'no'] })
      .default(false),
  })
  // A cursor is a pair; providing only one half is a malformed request, not "first page".
  .superRefine((value, ctx) => {
    const hasId = value.lastId !== undefined;
    const hasAt = value.lastCreatedAt !== undefined;
    if (hasId !== hasAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['lastId'],
        message: 'Provide both lastId and lastCreatedAt, or neither',
      });
    }
  });
export type Pagination = z.infer<typeof paginationSchema>;

/** Optional namespace filter, shared by list endpoints. */
export const namespaceFilterSchema = translationNamespaceSchema.optional();
