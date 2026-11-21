import { z } from 'zod';

import { isoDateTimeSchema } from './common.js';
import { aiMessageStatusSchema } from './enums.js';

/**
 * Token and cost accounting returned by the model provider, when available.
 * Derived from the same `z.record(z.string(), z.json()).nullable()` expression
 * as the shared `AiMessage['usage']` contract, so the shape stays identical.
 */
export const aiMessageUsageSchema = z.record(z.string(), z.json()).nullable();

/** Wire shape of the `ai_messages.usage` jsonb column: accounting or null. */
export type AiMessageWireUsage = z.infer<typeof aiMessageUsageSchema>;

/** AI provider call audit row as exposed by the admin API. */
export const aiMessageSchema = z.object({
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  id: z.uuid(),
  model: z.string(),
  provider: z.string(),
  response: z.string().nullable(),
  status: aiMessageStatusSchema,
  updatedAt: isoDateTimeSchema,
  /** Token and cost accounting returned by the model provider, when available. */
  usage: aiMessageUsageSchema,
});

/** Prompt captured for an AI call; role is `system`, `human` or the model's output role. */
export const aiMessagePromptSchema = z.object({
  createdAt: isoDateTimeSchema,
  id: z.uuid(),
  messageId: z.uuid(),
  prompt: z.string(),
  role: z.string().max(10),
});

/** Wire shape of an AI provider call audit row. */
export type AiMessage = z.infer<typeof aiMessageSchema>;
/** Wire shape of a prompt captured during an AI call. */
export type AiMessagePrompt = z.infer<typeof aiMessagePromptSchema>;
