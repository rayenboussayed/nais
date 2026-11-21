import { z } from 'zod';

/** Namespaces a translation can be tagged with; the `translation_namespace` pgEnum derives from this. */
export const translationNamespaceSchema = z.enum(['static', 'dynamic']);

/** Direction of the script; the `language_dir` pgEnum derives from this. */
export const languageDirSchema = z.enum(['ltr', 'rtl']);

/**
 * ISO 639-1 two-letter lowercase language code, e.g. `en`, `fr`, `ar`.
 * Note: only the 184 seeded two-letter codes validate here; BCP-47 tags such
 * as `zh-Hant` are intentionally out of scope for this service.
 */
export const iso6391Schema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}$/, 'Expected a two-letter lowercase ISO 639-1 code');

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

/** Maximum length of the source or translated text accepted by the API. */
export const MAX_TRANSLATION_TEXT_LENGTH = 50_000;

const textSchema = z.string().trim().min(1).max(MAX_TRANSLATION_TEXT_LENGTH);

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

/** Tasks the service can run; translation keeps the catalogue-backed implementation. */
export const AI_TASKS = [
  'translate',
  'sentiment',
  'summarize',
  'question-answering',
  'token-classification',
  'zero-shot-classification',
  'feature-extraction',
] as const;

export const aiTaskSchema = z.enum(AI_TASKS);

/** Task descriptor as exposed by `GET /api/ai/tasks`. */
export const aiTaskDescriptorSchema = z.object({
  /** One-line description of what the task does. */
  description: z.string(),
  /** Short human-readable label for UIs. */
  label: z.string(),
  model: z.string(),
  provider: z.enum(['ollama', 'transformers']),
  task: aiTaskSchema,
});
