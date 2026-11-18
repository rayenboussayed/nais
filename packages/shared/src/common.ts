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

/** Query-string keyset pagination and search, shared by the admin list endpoints. */
export const paginationSchema = z.object({
  /** Case-insensitive contains match, LIKE-escaped server-side. */
  q: z.string().trim().max(255).optional(),
  /** Anchor row of the previous page (id half of the `(created_at, id)` keyset). */
  lastId: z.uuid().optional(),
  /** Anchor row of the previous page (`created_at` half of the `(created_at, id)` keyset). */
  lastCreatedAt: isoDateTimeSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  orderBy: z.enum(['asc', 'desc']).default('desc'),
  /** Only the boolean tokens listed here parse as true/false; anything else is rejected. */
  onlyDeleted: z
    .stringbool({ truthy: ['true', '1', 'on', 'yes'], falsy: ['false', '0', 'off', 'no'] })
    .default(false),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** Optional namespace filter, shared by list endpoints. */
export const namespaceFilterSchema = translationNamespaceSchema.optional();
