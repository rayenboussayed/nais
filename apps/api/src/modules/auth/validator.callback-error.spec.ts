import { describe, expect, it, vi } from 'vitest';

vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return {
    ...original,
    scrypt: (
      _password: string,
      _salt: Uint8Array,
      _keylen: number,
      _options: unknown,
      callback: (error?: Error) => void,
    ) => {
      callback(new Error('kdf failed'));
    },
  };
});

describe('verifyScryptPassword callback failures', () => {
  it('returns false when the KDF reports an error through its callback', async () => {
    const { verifyScryptPassword } = await import('./validator.js');
    const salt = 'aa'.repeat(16);
    const expected = 'bb'.repeat(64);
    await expect(verifyScryptPassword(`scrypt$16384$8$1$${salt}$${expected}`, 'x')).resolves.toBe(
      false,
    );
  });
});
