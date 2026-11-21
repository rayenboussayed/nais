import { z } from 'zod';

import { languageDirSchema } from '../schemas/enums.js';
import { iso6391Schema, isoDateTimeSchema } from './common.js';

/** Language row as exposed by the API; `deletedAt` set means soft-deleted. */
export const languageSchema = z.object({
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  dir: languageDirSchema,
  id: z.uuid(),
  iso6391: iso6391Schema,
  isSource: z.boolean(),
  name: z.string(),
  nativeName: z.string(),
  updatedAt: isoDateTimeSchema,
});

export const createLanguageSchema = z.object({
  dir: languageDirSchema,
  iso6391: iso6391Schema,
  isSource: z.boolean().default(false),
  name: z.string().trim().min(1).max(255),
  nativeName: z.string().trim().min(1).max(255),
});

const updateLanguageBaseSchema = z.object({
  dir: languageDirSchema.optional(),
  iso6391: iso6391Schema.optional(),
  isSource: z.boolean().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  nativeName: z.string().trim().min(1).max(255).optional(),
});

/** Body of the REST PATCH endpoint; `id` comes from the route. */
export const updateLanguageBodySchema = updateLanguageBaseSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'Provide at least one field' },
);
/** Validated PATCH body for a language; at least one field must be defined. */
export type UpdateLanguageBodyInput = z.infer<typeof updateLanguageBodySchema>;

export const updateLanguageSchema = updateLanguageBaseSchema
  .extend({ id: z.uuid() })
  // A null value (e.g. clearing parentId) counts as a provided field; an explicit
  // undefined does not.
  .refine(
    (value) => Object.entries(value).some(([key, val]) => key !== 'id' && val !== undefined),
    {
      message: 'Provide at least one field besides id',
    },
  );

/** Validated body of `POST /api/languages`. */
export type CreateLanguageInput = z.infer<typeof createLanguageSchema>;
/** Language row as exposed by the API. */
export type Language = z.infer<typeof languageSchema>;
/** Validated full update input including the route id. */
export type UpdateLanguageInput = z.infer<typeof updateLanguageSchema>;
