import { z } from 'zod';

/** Namespaces a translation can be tagged with; the `translation_namespace` pgEnum derives from this. */
export const translationNamespaceSchema = z.enum(['static', 'dynamic']);
/** Direction of the script; the `language_dir` pgEnum derives from this. */
export const languageDirSchema = z.enum(['ltr', 'rtl']);
/** Lifecycle of an AI provider call; the `ai_message_status` pgEnum derives from this. */
export const aiMessageStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

/** Language direction values derived from {@link languageDirSchema}. */
export type LanguageDir = z.infer<typeof languageDirSchema>;
