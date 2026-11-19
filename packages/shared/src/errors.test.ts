import { describe, expect, it } from 'vitest';

import { apiErrorSchema } from './errors';

describe('apiErrorSchema', () => {
  it('accepts a single-message Nest error body', () => {
    const parsed = apiErrorSchema.parse({ message: 'Translation not found', statusCode: 404 });
    expect(parsed.statusCode).toBe(404);
  });

  it('accepts a multi-issue validation body', () => {
    const parsed = apiErrorSchema.parse({
      error: 'Bad Request',
      message: ['text must contain at least 1 character', 'targetLanguage invalid'],
      statusCode: 400,
    });
    expect(parsed.message).toHaveLength(2);
  });

  it('rejects malformed bodies', () => {
    expect(() => apiErrorSchema.parse({ message: 'too low', statusCode: 99 })).toThrow();
    expect(() => apiErrorSchema.parse({ statusCode: 400 })).toThrow();
    expect(() => apiErrorSchema.parse({ message: 'x', statusCode: '400' })).toThrow();
  });
});
