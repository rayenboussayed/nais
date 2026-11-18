import { z } from 'zod';

import { translationNamespaceSchema } from './enums';
import { iso6391Schema, isoDateTimeSchema } from './common';

/** Maximum length of the source or translated text accepted by the API. */
export const MAX_TRANSLATION_TEXT_LENGTH = 50_000;

const textSchema = z.string().trim().min(1).max(MAX_TRANSLATION_TEXT_LENGTH);

/** Request body for `POST /api/translate`. */
export const translateRequestSchema = z.object({
  text: textSchema,
  /** Two-letter ISO 639-1 code of the language to translate into; must exist in the seeded languages. */
  targetLanguage: iso6391Schema,
});

/** Response body for a successful translation. */
export const translateResponseSchema = z.object({
  text: z.string(),
  /** True when served from the translations table without calling the model. */
  cached: z.boolean(),
});

/** Translation row as exposed by the admin API. */
export const translationSchema = z.object({
  id: z.uuid(),
  languageId: z.uuid(),
  namespace: translationNamespaceSchema,
  /**
   * `dynamic` rows carry `sha512(nfcTrimmedText)` as base64url (server-derived by the
   * translate pipeline); `static` rows carry a human-authored key. Keys are immutable
   * per row and unique per `(languageId, key)`.
   */
  key: z.string(),
  text: z.string(),
  parentId: z.uuid().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

/**
 * Admin create for translations. Client-created rows are `static` (human-authored key)
 * or `dynamic` (key derived server-side as the sha512 of the text). The AI translate
 * pipeline never uses this schema; it inserts directly with the derived key.
 */
export const createTranslationSchema = z.discriminatedUnion('namespace', [
  z.object({
    namespace: z.literal('static'),
    languageId: z.uuid(),
    text: textSchema,
    key: z.string().trim().min(1).max(255),
  }),
  z.object({
    namespace: z.literal('dynamic'),
    languageId: z.uuid(),
    text: textSchema,
  }),
]);

export const updateTranslationSchema = z
  .object({
    id: z.uuid(),
    languageId: z.uuid().optional(),
    namespace: translationNamespaceSchema.optional(),
    text: textSchema.optional(),
    key: z.string().trim().min(1).max(255).optional(),
    parentId: z.uuid().nullable().optional(),
  })
  // A null value (e.g. clearing parentId) counts as a provided field; an explicit
  // undefined does not.
  .refine(
    (value) => Object.entries(value).some(([key, val]) => key !== 'id' && val !== undefined),
    {
      message: 'Provide at least one field besides id',
    },
  );

/** WebSocket `translate` message from the client; requestId is a client-generated correlation uuid. */
export const wsTranslateMessageSchema = translateRequestSchema.extend({
  requestId: z.uuid(),
});

/** Server-to-client event emitted when an async translation completes. */
export const wsTranslationEventSchema = z.object({
  requestId: z.uuid(),
  text: z.string(),
  cached: z.boolean(),
});

/** Server-to-client event emitted when an async translation fails. */
export const wsTranslationErrorEventSchema = z.object({
  requestId: z.uuid(),
  message: z.string(),
});

export type TranslateRequest = z.infer<typeof translateRequestSchema>;
export type TranslateResponse = z.infer<typeof translateResponseSchema>;
export type Translation = z.infer<typeof translationSchema>;
export type CreateTranslationInput = z.infer<typeof createTranslationSchema>;
export type UpdateTranslationInput = z.infer<typeof updateTranslationSchema>;
export type WsTranslateMessage = z.infer<typeof wsTranslateMessageSchema>;
export type WsTranslationEvent = z.infer<typeof wsTranslationEventSchema>;
export type WsTranslationErrorEvent = z.infer<typeof wsTranslationErrorEventSchema>;
