import { z } from 'zod';

import { cursorPairRefine, paginationBaseSchema } from '@trainslator/shared';
import { translationNamespaceSchema } from '@trainslator/shared';

/** List query for `/api/translations`: pagination plus catalogue filters. */
export const translationsListQuerySchema = paginationBaseSchema
  .extend({
    languageId: z.uuid().optional(),
    namespace: translationNamespaceSchema.optional(),
  })
  .superRefine(cursorPairRefine);
export type TranslationsListQuery = z.infer<typeof translationsListQuerySchema>;
