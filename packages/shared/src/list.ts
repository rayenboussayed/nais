import { z } from 'zod';

import { cursorTimestampSchema } from './common';

/**
 * Keyset-paginated list envelope. Callers pass the item schema; the response
 * exposes the items plus an opaque cursor pair or null when the page is the
 * last one.
 */
export const keysetListSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    next: z
      .object({
        lastId: z.uuid(),
        lastCreatedAt: cursorTimestampSchema,
      })
      .nullable(),
  });

/**
 * Wire shape produced by {@link keysetListSchema}: items plus an opaque cursor
 * pair, or null on the last page. Kept as a hand-written structural alias
 * because TS instantiation expressions in type aliases don't survive the
 * zod v4 generic chain; the schema is the runtime source of truth.
 */
export type KeysetList<T> = {
  items: T[];
  next: { lastId: string; lastCreatedAt: string } | null;
};
