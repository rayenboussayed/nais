import { z } from 'zod';

/**
 * Shape of error responses produced by Nest's default exception filter and by
 * the global filter registered in apps/api. `message` may be a single string
 * or the array produced when a validation source reports multiple issues.
 */
export const apiErrorSchema = z.object({
  error: z.string().optional(),
  message: z.union([z.string(), z.array(z.string())]),
  statusCode: z.number().int().min(100).max(599),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
