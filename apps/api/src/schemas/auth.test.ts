import { describe, expect, it } from 'vitest';

import { loginRequestSchema } from './auth.js';

describe('loginRequestSchema', () => {
  it('accepts a valid login and trims the username', () => {
    const parsed = loginRequestSchema.parse({ password: 'secret', username: '  admin  ' });
    expect(parsed.username).toBe('admin');
  });

  it('rejects empty username and password', () => {
    expect(() => loginRequestSchema.parse({ password: 'x', username: '   ' })).toThrow();
    expect(() => loginRequestSchema.parse({ password: '', username: 'admin' })).toThrow();
  });

  it('rejects overlong passwords', () => {
    expect(() =>
      loginRequestSchema.parse({ password: 'x'.repeat(513), username: 'admin' }),
    ).toThrow();
  });
});
