import { z } from 'zod';

import { iso6391Schema } from './common.js';

/** Maximum length of a text field accepted by the AI endpoints. */
const MAX_AI_TEXT_LENGTH = 50_000;

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
export type AiTask = z.infer<typeof aiTaskSchema>;

const textSchema = z.string().trim().min(1).max(MAX_AI_TEXT_LENGTH);
const shortTextSchema = z.string().trim().min(1).max(1_000);

/** translate: input/output identical to `/api/translate`. */
export const aiTranslateRequestSchema = z.object({
  targetLanguage: iso6391Schema,
  text: textSchema,
});
const aiTranslateResultSchema = z.object({
  cached: z.boolean(),
  text: z.string(),
});
export type AiTranslateRequest = z.infer<typeof aiTranslateRequestSchema>;

/** sentiment: text in, label + score out. */
export const aiSentimentRequestSchema = z.object({ text: textSchema });
export const aiSentimentResultSchema = z.object({
  cached: z.boolean(),
  label: z.string(),
  score: z.number().min(0).max(1),
});
export type AiSentimentResult = z.infer<typeof aiSentimentResultSchema>;

/** summarize: document in, shorter text out. */
export const aiSummarizeRequestSchema = z.object({ text: textSchema });
export const aiSummarizeResultSchema = z.object({
  cached: z.boolean(),
  text: z.string(),
});
export type AiSummarizeResult = z.infer<typeof aiSummarizeResultSchema>;

/** question-answering: extractive — answer span inside `context`. */
export const aiQuestionAnsweringRequestSchema = z.object({
  context: textSchema,
  question: shortTextSchema,
});
export const aiQuestionAnsweringResultSchema = z.object({
  answer: z.string(),
  cached: z.boolean(),
  end: z.number().int().nonnegative(),
  score: z.number().min(0).max(1),
  start: z.number().int().nonnegative(),
});
export type AiQuestionAnsweringResult = z.infer<typeof aiQuestionAnsweringResultSchema>;

/** token-classification (NER): entities found in `text`. */
const aiEntitySchema = z.object({
  end: z.number().int().nonnegative(),
  entity_group: z.string(),
  score: z.number().min(0).max(1),
  start: z.number().int().nonnegative(),
  word: z.string(),
});
export const aiTokenClassificationRequestSchema = z.object({ text: textSchema });
export const aiTokenClassificationResultSchema = z.object({
  cached: z.boolean(),
  entities: z.array(aiEntitySchema),
});
export type AiTokenClassificationResult = z.infer<typeof aiTokenClassificationResultSchema>;

/** zero-shot-classification: classify into arbitrary labels without retraining. */
export const aiZeroShotClassificationRequestSchema = z.object({
  candidateLabels: z.array(z.string().trim().min(1).max(100)).min(2).max(20),
  text: textSchema,
});
export const aiZeroShotClassificationResultSchema = z.object({
  cached: z.boolean(),
  labels: z.array(z.string()),
  scores: z.array(z.number().min(0).max(1)),
  sequence: z.string(),
});
export type AiZeroShotClassificationResult = z.infer<typeof aiZeroShotClassificationResultSchema>;

/** feature-extraction: text in, dense embedding out. */
export const aiFeatureExtractionRequestSchema = z.object({ text: textSchema });
export const aiFeatureExtractionResultSchema = z.object({
  cached: z.boolean(),
  dimensions: z.number().int().nonnegative(),
  embedding: z.array(z.number()),
});
export type AiFeatureExtractionResult = z.infer<typeof aiFeatureExtractionResultSchema>;

/** Per-task input/result schema lookup, keyed by task name. */
export const aiRequestSchemas = {
  'feature-extraction': aiFeatureExtractionRequestSchema,
  'question-answering': aiQuestionAnsweringRequestSchema,
  sentiment: aiSentimentRequestSchema,
  summarize: aiSummarizeRequestSchema,
  'token-classification': aiTokenClassificationRequestSchema,
  translate: aiTranslateRequestSchema,
  'zero-shot-classification': aiZeroShotClassificationRequestSchema,
} as const;

export const aiResultSchemas = {
  'feature-extraction': aiFeatureExtractionResultSchema,
  'question-answering': aiQuestionAnsweringResultSchema,
  sentiment: aiSentimentResultSchema,
  summarize: aiSummarizeResultSchema,
  'token-classification': aiTokenClassificationResultSchema,
  translate: aiTranslateResultSchema,
  'zero-shot-classification': aiZeroShotClassificationResultSchema,
} as const;

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
export type AiTaskDescriptor = z.infer<typeof aiTaskDescriptorSchema>;
export const aiTaskListResponseSchema = z.object({
  items: z.array(aiTaskDescriptorSchema),
});
