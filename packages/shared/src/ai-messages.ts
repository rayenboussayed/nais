import { z } from 'zod';

import { isoDateTimeSchema } from './common';
import { aiMessageStatusSchema } from './enums';

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
  usage: z.record(z.string(), z.json()).nullable(),
});

/** Prompt captured for an AI call; role is `system`, `human` or the model's output role. */
export const aiMessagePromptSchema = z.object({
  createdAt: isoDateTimeSchema,
  id: z.uuid(),
  messageId: z.uuid(),
  prompt: z.string(),
  role: z.string().max(10),
});

export type AiMessage = z.infer<typeof aiMessageSchema>;
export type AiMessagePrompt = z.infer<typeof aiMessagePromptSchema>;
