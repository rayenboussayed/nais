import { z } from 'zod';

/** Body of `POST /api/auth/login`. */
export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(512),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
