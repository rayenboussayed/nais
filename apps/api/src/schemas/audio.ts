import { z } from 'zod';

import { iso6391Schema } from './common.js';

/** Maximum decoded audio payload accepted by the speech-to-text endpoint (5 MiB). */
export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** Maximum base64 character length of a 5 MiB audio payload, including padding. */
export const MAX_BASE64_LENGTH = 4 * Math.ceil(MAX_AUDIO_BYTES / 3);

/**
 * Language selector for transcription: `auto` detects the language per chunk,
 * `lock` detects it once, and any two-letter ISO 639-1 code pins it explicitly.
 */
export const sttLanguageSchema = z.union([z.literal('auto'), z.literal('lock'), iso6391Schema]);

/** Validated base64 audio payload with an optional language selector. */
export const sttRequestSchema = z.object({
  audio: z.base64().min(1).max(MAX_BASE64_LENGTH),
  language: sttLanguageSchema.optional(),
});
/** Parsed speech-to-text request body. */
export type SttRequest = z.infer<typeof sttRequestSchema>;

/** One transcribed segment with millisecond timestamps. */
export const sttSegmentSchema = z.object({
  end: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  text: z.string(),
});
/** A single transcribed segment as returned by the service. */
export type SttSegment = z.infer<typeof sttSegmentSchema>;

/** Speech-to-text result: joined text, timed segments and the device that produced them. */
export const sttResponseSchema = z.object({
  device: z.enum(['gpu', 'cpu']),
  segments: z.array(sttSegmentSchema),
  text: z.string(),
});
/** Speech-to-text result as returned by the endpoint. */
export type SttResponse = z.infer<typeof sttResponseSchema>;
