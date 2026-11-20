import { z } from 'zod';

import { iso6391Schema, isoDateTimeSchema, wsAckStatusCodeSchema } from './common';
import { translationNamespaceSchema } from './enums';

/** Maximum length of the source or translated text accepted by the API. */
export const MAX_TRANSLATION_TEXT_LENGTH = 50_000;

const textSchema = z.string().trim().min(1).max(MAX_TRANSLATION_TEXT_LENGTH);

/** Request body for `POST /api/translate`. */
export const translateRequestSchema = z.object({
  /** Two-letter ISO 639-1 code of the language to translate into; must exist in the seeded languages. */
  targetLanguage: iso6391Schema,
  text: textSchema,
});

/** Response body for a successful translation. */
export const translateResponseSchema = z.object({
  /** True when served from the translations table without calling the model. */
  cached: z.boolean(),
  text: z.string(),
});

/** Translation row as exposed by the admin API. */
export const translationSchema = z.object({
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  id: z.uuid(),
  /**
   * `dynamic` rows carry `sha512(nfcTrimmedText)` as base64url (server-derived by the
   * translate pipeline); `static` rows carry a human-authored key. Keys are immutable
   * per row and unique per `(languageId, key)`.
   */
  key: z.string(),
  languageId: z.uuid(),
  namespace: translationNamespaceSchema,
  parentId: z.uuid().nullable(),
  text: z.string(),
  updatedAt: isoDateTimeSchema,
});

/**
 * Admin create for translations. Client-created rows are `static` (human-authored key)
 * or `dynamic` (key derived server-side as the sha512 of the text). The AI translate
 * pipeline never uses this schema; it inserts directly with the derived key.
 */
export const createTranslationSchema = z.discriminatedUnion('namespace', [
  z.object({
    key: z.string().trim().min(1).max(255),
    languageId: z.uuid(),
    namespace: z.literal('static'),
    parentId: z.uuid().optional(),
    text: textSchema,
  }),
  z.object({
    languageId: z.uuid(),
    namespace: z.literal('dynamic'),
    text: textSchema,
  }),
]);

const updateTranslationBaseSchema = z.object({
  key: z.string().trim().min(1).max(255).optional(),
  languageId: z.uuid().optional(),
  namespace: translationNamespaceSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  text: textSchema.optional(),
});

/** Body of the REST PATCH endpoint; `id` comes from the route. */
export const updateTranslationBodySchema = updateTranslationBaseSchema.refine(
  (value) => Object.values(value).some((field) => field !== undefined),
  { message: 'Provide at least one field' },
);
export type UpdateTranslationBodyInput = z.infer<typeof updateTranslationBodySchema>;

export const updateTranslationSchema = updateTranslationBaseSchema
  .extend({ id: z.uuid() })
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
  cached: z.boolean(),
  requestId: z.uuid(),
  text: z.string(),
});

/** Server ack for the `translate` message: receipt, not the result (that comes via `translation`). */
export const wsTranslateAckSchema = z.object({
  /** The translation on cache hit (200); null otherwise. */
  data: z.string().nullable(),
  /** Correlation id from the request; null when the client sent an unparseable message. */
  requestId: z.union([z.uuid(), z.null()]),
  /** Present only on 429: how long to wait before retrying, in milliseconds. */
  retryAfterMs: z.number().int().nonnegative().optional(),
  statusCode: wsAckStatusCodeSchema,
});

/** Server-to-client event emitted when an async translation fails. */
export const wsTranslationErrorEventSchema = z.object({
  message: z.string(),
  requestId: z.uuid(),
});

export type CreateTranslationInput = z.infer<typeof createTranslationSchema>;
export type TranslateRequest = z.infer<typeof translateRequestSchema>;
export type TranslateResponse = z.infer<typeof translateResponseSchema>;
export type Translation = z.infer<typeof translationSchema>;
export type UpdateTranslationInput = z.infer<typeof updateTranslationSchema>;
export type WsTranslateAck = z.infer<typeof wsTranslateAckSchema>;
export type WsTranslateMessage = z.infer<typeof wsTranslateMessageSchema>;
export type WsTranslationErrorEvent = z.infer<typeof wsTranslationErrorEventSchema>;
export type WsTranslationEvent = z.infer<typeof wsTranslationEventSchema>;
