import { z } from 'zod';

import { aiMessageStatusSchema } from './enums';
import { isoDateTimeSchema } from './common';

/** AI provider call audit row as exposed by the admin API. */
export const aiMessageSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  model: z.string(),
  status: aiMessageStatusSchema,
  response: z.string().nullable(),
  /** Token and cost accounting returned by the model provider, when available. */
  usage: z.record(z.string(), z.json()).nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

/** Prompt captured for an AI call; role is `system`, `human` or the model's output role. */
export const aiMessagePromptSchema = z.object({
  id: z.uuid(),
  messageId: z.uuid(),
  role: z.string().max(10),
  prompt: z.string(),
  createdAt: isoDateTimeSchema,
});

export type AiMessage = z.infer<typeof aiMessageSchema>;
export type AiMessagePrompt = z.infer<typeof aiMessagePromptSchema>;
