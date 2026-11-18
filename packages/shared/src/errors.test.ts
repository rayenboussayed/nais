import { describe, expect, it } from 'vitest';

import { apiErrorSchema } from './errors';

describe('apiErrorSchema', () => {
  it('accepts a single-message Nest error body', () => {
    const parsed = apiErrorSchema.parse({ statusCode: 404, message: 'Translation not found' });
    expect(parsed.statusCode).toBe(404);
  });

  it('accepts a multi-issue validation body', () => {
    const parsed = apiErrorSchema.parse({
      statusCode: 400,
      message: ['text must contain at least 1 character', 'targetLanguage invalid'],
      error: 'Bad Request',
    });
    expect(parsed.message).toHaveLength(2);
  });

  it('rejects malformed bodies', () => {
    expect(() => apiErrorSchema.parse({ statusCode: 99, message: 'too low' })).toThrow();
    expect(() => apiErrorSchema.parse({ statusCode: 400 })).toThrow();
    expect(() => apiErrorSchema.parse({ statusCode: '400', message: 'x' })).toThrow();
  });
});
