import { z } from 'zod';

import { languageDirSchema } from './enums';
import { iso6391Schema, isoDateTimeSchema } from './common';

/** Language row as exposed by the API; `deletedAt` set means soft-deleted. */
export const languageSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  nativeName: z.string(),
  iso6391: iso6391Schema,
  dir: languageDirSchema,
  isSource: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

export const createLanguageSchema = z.object({
  name: z.string().trim().min(1).max(255),
  nativeName: z.string().trim().min(1).max(255),
  iso6391: iso6391Schema,
  dir: languageDirSchema,
  isSource: z.boolean().default(false),
});

export const updateLanguageSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(255).optional(),
    nativeName: z.string().trim().min(1).max(255).optional(),
    iso6391: iso6391Schema.optional(),
    dir: languageDirSchema.optional(),
    isSource: z.boolean().optional(),
  })
  // A null value (e.g. clearing parentId) counts as a provided field; an explicit
  // undefined does not.
  .refine(
    (value) => Object.entries(value).some(([key, val]) => key !== 'id' && val !== undefined),
    {
      message: 'Provide at least one field besides id',
    },
  );

export type Language = z.infer<typeof languageSchema>;
export type CreateLanguageInput = z.infer<typeof createLanguageSchema>;
export type UpdateLanguageInput = z.infer<typeof updateLanguageSchema>;
