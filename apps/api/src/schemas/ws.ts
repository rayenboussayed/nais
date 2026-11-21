import { z } from 'zod';

import { aiTaskSchema } from './ai.js';
import { wsAckStatusCodeSchema } from './common.js';

/** Wire shape of an `ai` WebSocket message: task + task-specific input. */
export const wsAiMessageSchema = z.object({
  input: z.unknown(),
  requestId: z.uuid(),
  task: aiTaskSchema,
});

/** Server ack for the `ai` message — same contract as `translate`. */
export const wsAiAckSchema = z.object({
  /** True when served from the cache (200); null otherwise. */
  cached: z.boolean().nullable(),
  /** Correlation id from the request; null when the client sent an unparseable message. */
  requestId: z.union([z.uuid(), z.null()]),
  /** The task-shaped result, present only on inline cache hits (200). */
  result: z.record(z.string(), z.unknown()).nullable(),
  /** Present only on 429: how long to wait before retrying, in milliseconds. */
  retryAfterMs: z.number().int().nonnegative().optional(),
  statusCode: wsAckStatusCodeSchema,
});
export type WsAiAck = z.infer<typeof wsAiAckSchema>;

/** `ai-result` event pushed on completion of a queued task. */
export const wsAiResultEventSchema = z.object({
  cached: z.boolean(),
  requestId: z.uuid(),
  /** Task-shaped result object (typed per task; validated client-side against the relevant schema). */
  result: z.record(z.string(), z.unknown()),
  task: aiTaskSchema,
});
export type WsAiResultEvent = z.infer<typeof wsAiResultEventSchema>;

/** `ai-error` event pushed when a queued task fails. */
export const wsAiErrorEventSchema = z.object({
  message: z.string(),
  requestId: z.uuid(),
  task: aiTaskSchema,
});
export type WsAiErrorEvent = z.infer<typeof wsAiErrorEventSchema>;
