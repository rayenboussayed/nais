import { z } from 'zod';

import { iso6391Schema, isoDateTimeSchema } from './common';

/** Maximum length of a text field accepted by the AI endpoints. */
export const MAX_AI_TEXT_LENGTH = 50_000;

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
  text: textSchema,
  targetLanguage: iso6391Schema,
});
export const aiTranslateResultSchema = z.object({
  text: z.string(),
  /** True when served from the translations catalogue. */
  cached: z.boolean(),
});
export type AiTranslateRequest = z.infer<typeof aiTranslateRequestSchema>;
export type AiTranslateResult = z.infer<typeof aiTranslateResultSchema>;

/** sentiment: text in, label + score out. */
export const aiSentimentRequestSchema = z.object({ text: textSchema });
export const aiSentimentResultSchema = z.object({
  label: z.string(),
  score: z.number().min(0).max(1),
  cached: z.boolean(),
});
export type AiSentimentRequest = z.infer<typeof aiSentimentRequestSchema>;
export type AiSentimentResult = z.infer<typeof aiSentimentResultSchema>;

/** summarize: document in, shorter text out. */
export const aiSummarizeRequestSchema = z.object({ text: textSchema });
export const aiSummarizeResultSchema = z.object({
  text: z.string(),
  cached: z.boolean(),
});
export type AiSummarizeRequest = z.infer<typeof aiSummarizeRequestSchema>;
export type AiSummarizeResult = z.infer<typeof aiSummarizeResultSchema>;

/** question-answering: extractive — answer span inside `context`. */
export const aiQuestionAnsweringRequestSchema = z.object({
  question: shortTextSchema,
  context: textSchema,
});
export const aiQuestionAnsweringResultSchema = z.object({
  answer: z.string(),
  score: z.number().min(0).max(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  cached: z.boolean(),
});
export type AiQuestionAnsweringRequest = z.infer<typeof aiQuestionAnsweringRequestSchema>;
export type AiQuestionAnsweringResult = z.infer<typeof aiQuestionAnsweringResultSchema>;

/** token-classification (NER): entities found in `text`. */
export const aiEntitySchema = z.object({
  word: z.string(),
  entity_group: z.string(),
  score: z.number().min(0).max(1),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
export const aiTokenClassificationRequestSchema = z.object({ text: textSchema });
export const aiTokenClassificationResultSchema = z.object({
  entities: z.array(aiEntitySchema),
  cached: z.boolean(),
});
export type AiTokenClassificationRequest = z.infer<typeof aiTokenClassificationRequestSchema>;
export type AiTokenClassificationResult = z.infer<typeof aiTokenClassificationResultSchema>;

/** zero-shot-classification: classify into arbitrary labels without retraining. */
export const aiZeroShotClassificationRequestSchema = z.object({
  text: textSchema,
  candidateLabels: z.array(z.string().trim().min(1).max(100)).min(2).max(20),
});
export const aiZeroShotClassificationResultSchema = z.object({
  sequence: z.string(),
  labels: z.array(z.string()),
  scores: z.array(z.number().min(0).max(1)),
  cached: z.boolean(),
});
export type AiZeroShotClassificationRequest = z.infer<typeof aiZeroShotClassificationRequestSchema>;
export type AiZeroShotClassificationResult = z.infer<typeof aiZeroShotClassificationResultSchema>;

/** feature-extraction: text in, dense embedding out. */
export const aiFeatureExtractionRequestSchema = z.object({ text: textSchema });
export const aiFeatureExtractionResultSchema = z.object({
  embedding: z.array(z.number()),
  dimensions: z.number().int().nonnegative(),
  cached: z.boolean(),
});
export type AiFeatureExtractionRequest = z.infer<typeof aiFeatureExtractionRequestSchema>;
export type AiFeatureExtractionResult = z.infer<typeof aiFeatureExtractionResultSchema>;

/** Per-task input/result schema lookup, keyed by task name. */
export const aiRequestSchemas = {
  translate: aiTranslateRequestSchema,
  sentiment: aiSentimentRequestSchema,
  summarize: aiSummarizeRequestSchema,
  'question-answering': aiQuestionAnsweringRequestSchema,
  'token-classification': aiTokenClassificationRequestSchema,
  'zero-shot-classification': aiZeroShotClassificationRequestSchema,
  'feature-extraction': aiFeatureExtractionRequestSchema,
} as const;

export const aiResultSchemas = {
  translate: aiTranslateResultSchema,
  sentiment: aiSentimentResultSchema,
  summarize: aiSummarizeResultSchema,
  'question-answering': aiQuestionAnsweringResultSchema,
  'token-classification': aiTokenClassificationResultSchema,
  'zero-shot-classification': aiZeroShotClassificationResultSchema,
  'feature-extraction': aiFeatureExtractionResultSchema,
} as const;

/** Task descriptor as exposed by `GET /api/ai/tasks`. */
export const aiTaskDescriptorSchema = z.object({
  task: aiTaskSchema,
  provider: z.enum(['ollama', 'transformers']),
  model: z.string(),
  /** Short human-readable label for UIs. */
  label: z.string(),
  /** One-line description of what the task does. */
  description: z.string(),
});
export type AiTaskDescriptor = z.infer<typeof aiTaskDescriptorSchema>;
export const aiTaskListResponseSchema = z.object({
  items: z.array(aiTaskDescriptorSchema),
});

/** Wire shape of an `ai` WebSocket message: task + task-specific input. */
export const wsAiMessageSchema = z.object({
  task: aiTaskSchema,
  input: z.unknown(),
  requestId: z.uuid(),
});
export type WsAiMessage = z.infer<typeof wsAiMessageSchema>;

/** Server ack for the `ai` message — same contract as `translate`. */
export const wsAiAckSchema = z.object({
  statusCode: z.union([
    z.literal(200),
    z.literal(202),
    z.literal(400),
    z.literal(404),
    z.literal(429),
    z.literal(500),
  ]),
  /** Correlation id from the request; null when the client sent an unparseable message. */
  requestId: z.union([z.uuid(), z.null()]),
  /** True when served from the cache (200); null otherwise. */
  cached: z.boolean().nullable(),
  /** The task-shaped result, present only on inline cache hits (200). */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Present only on 429: how long to wait before retrying, in milliseconds. */
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type WsAiAck = z.infer<typeof wsAiAckSchema>;

/** pg-boss job payload for the `ai-task` queue. */
export const aiTaskJobSchema = z.object({
  task: aiTaskSchema,
  input: z.record(z.string(), z.unknown()),
  requestId: z.uuid(),
  socketId: z.string().optional(),
});
export type AiTaskJob = z.infer<typeof aiTaskJobSchema>;

/** `ai-result` event pushed on completion of a queued task. */
export const wsAiResultEventSchema = z.object({
  requestId: z.uuid(),
  task: aiTaskSchema,
  /** Task-shaped result object (typed per task; validated client-side against the relevant schema). */
  result: z.record(z.string(), z.unknown()),
  cached: z.boolean(),
});
export type WsAiResultEvent = z.infer<typeof wsAiResultEventSchema>;

/** `ai-error` event pushed when a queued task fails. */
export const wsAiErrorEventSchema = z.object({
  requestId: z.uuid(),
  task: aiTaskSchema,
  message: z.string(),
});
export type WsAiErrorEvent = z.infer<typeof wsAiErrorEventSchema>;

/** Stored row of the ai_cache table as returned by the admin API later; kept for contract stability. */
export const aiCacheEntrySchema = z.object({
  id: z.uuid(),
  task: aiTaskSchema,
  model: z.string(),
  key: z.string(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});
