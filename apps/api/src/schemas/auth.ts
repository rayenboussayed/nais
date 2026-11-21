import { z } from 'zod';

/** Body of `POST /api/auth/login`. */
export const loginRequestSchema = z.object({
  password: z.string().min(1).max(512),
  username: z.string().trim().min(1).max(255),
});

/** Validated body of `POST /api/auth/login`. */
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** Response body of `POST /api/auth/login`. */
export const loginResponseSchema = z.object({
  username: z.string(),
});
