import { describe, expect, it, vi } from 'vitest';

vi.mock('@nestjs/config', () => ({ ConfigService: undefined }));

describe('HttpAuthGuard decorator fallback', () => {
  it('still defines the guard when decorator metadata cannot resolve ConfigService', async () => {
    const { HttpAuthGuard } = await import('./auth.guard.js');
    expect(HttpAuthGuard).toBeTypeOf('function');
  });
});
