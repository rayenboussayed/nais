import { z } from 'zod';

import { translationNamespaceSchema } from '../schemas/enums.js';
import { cursorPairRefine, paginationBaseSchema } from './common.js';

/** List query for `/api/translations`: pagination plus catalogue filters. */
export const translationsListQuerySchema = paginationBaseSchema
  .extend({
    languageId: z.uuid().optional(),
    namespace: translationNamespaceSchema.optional(),
  })
  .superRefine(cursorPairRefine);
/** Validated query for `GET /api/translations`. */
export type TranslationsListQuery = z.infer<typeof translationsListQuerySchema>;
