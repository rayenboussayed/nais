import { z } from 'zod';

/** Namespaces a translation can be tagged with; mirrors the `translation_namespace` pgEnum. */
export const translationNamespaceSchema = z.enum(['static', 'dynamic']);
/** Direction of the script; mirrors the `language_dir` pgEnum. */
export const languageDirSchema = z.enum(['ltr', 'rtl']);
/** Lifecycle of an AI provider call; mirrors the `ai_message_status` pgEnum. */
export const aiMessageStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

export type TranslationNamespace = z.infer<typeof translationNamespaceSchema>;
export type LanguageDir = z.infer<typeof languageDirSchema>;
export type AiMessageStatus = z.infer<typeof aiMessageStatusSchema>;
