import { z } from 'zod';

import { aiTaskSchema } from './ai.js';

/** pg-boss job payload for the `ai-task` queue. */
export const aiTaskJobSchema = z.object({
  input: z.record(z.string(), z.unknown()),
  requestId: z.uuid(),
  socketId: z.string().optional(),
  task: aiTaskSchema,
});
export type AiTaskJob = z.infer<typeof aiTaskJobSchema>;
