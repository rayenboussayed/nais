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
 * pair, or null on the last page. Derived directly from the zod schema so the
 * compile-time shape cannot drift from the runtime one.
 */
export type KeysetList<T> = z.infer<ReturnType<typeof keysetListSchema<z.ZodType<T>>>>;
