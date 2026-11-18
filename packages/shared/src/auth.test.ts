import { describe, expect, it } from 'vitest';

import { loginRequestSchema } from './auth';

describe('loginRequestSchema', () => {
  it('accepts a valid login and trims the username', () => {
    const parsed = loginRequestSchema.parse({ username: '  admin  ', password: 'secret' });
    expect(parsed.username).toBe('admin');
  });

  it('rejects empty username and password', () => {
    expect(() => loginRequestSchema.parse({ username: '   ', password: 'x' })).toThrow();
    expect(() => loginRequestSchema.parse({ username: 'admin', password: '' })).toThrow();
  });

  it('rejects overlong passwords', () => {
    expect(() =>
      loginRequestSchema.parse({ username: 'admin', password: 'x'.repeat(513) }),
    ).toThrow();
  });
});
