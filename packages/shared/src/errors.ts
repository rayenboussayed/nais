import { z } from 'zod';

/**
 * Shape of error responses produced by Nest's default exception filter and by
 * the global filter registered in apps/api. `message` may be a single string
 * or the array produced when a validation source reports multiple issues.
 */
export const apiErrorSchema = z.object({
  statusCode: z.number().int().min(100).max(599),
  message: z.union([z.string(), z.array(z.string())]),
  error: z.string().optional(),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
