import 'zod/compile';
import { describe, expect, it } from 'vitest';

import { loginRequestSchema } from './schemas/auth.js';
import { paginationSchema } from './schemas/common.js';

// The side-effect import stays first so the compiler's post processor is
// installed before the real contract modules below evaluate and build schemas.
describe('zod/compile side-effect import', () => {
  it('parses valid input with a contract built after the import', () => {
    expect(loginRequestSchema.parse({ password: 'secret', username: '  admin  ' })).toEqual({
      password: 'secret',
      username: 'admin',
    });
  });

  it('keeps the contract issue message for invalid input', () => {
    const result = loginRequestSchema.safeParse({ password: 'secret', username: '   ' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Too small: expected string to have >=1 characters',
      );
    }
  });

  it('parses valid input through the superRefine pagination contract', () => {
    expect(
      paginationSchema.parse({
        lastCreatedAt: '2026-01-02T03:04:05Z',
        lastId: '550e8400-e29b-41d4-a716-446655440000',
      }),
    ).toEqual({
      lastCreatedAt: '2026-01-02T03:04:05Z',
      lastId: '550e8400-e29b-41d4-a716-446655440000',
      onlyDeleted: false,
      orderBy: 'desc',
      pageSize: 20,
    });
  });

  it('keeps the custom cursor-pair issue message on invalid input', () => {
    const result = paginationSchema.safeParse({ lastId: '550e8400-e29b-41d4-a716-446655440000' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        'Provide both lastId and lastCreatedAt, or neither',
      );
    }
  });
});
