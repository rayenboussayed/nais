import { scryptSync, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyScryptPassword } from './validator.js';

function makeHash(password: string, N = 16384, r = 8, p = 1): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

describe('verifyScryptPassword', () => {
  it('accepts the correct password', async () => {
    await expect(verifyScryptPassword(makeHash('secret'), 'secret')).resolves.toBe(true);
  });

  it('rejects wrong passwords regardless of length', async () => {
    const hash = makeHash('secret');
    await expect(verifyScryptPassword(hash, 'secre')).resolves.toBe(false);
    await expect(verifyScryptPassword(hash, 'secrets')).resolves.toBe(false);
    await expect(verifyScryptPassword(hash, 'SECRET')).resolves.toBe(false);
  });

  it('rejects malformed hashes deterministically', async () => {
    for (const bad of [
      '',
      'scrypt$1$2$3$zz$yy',
      'argon2$1$2$3$aa$bb',
      'scrypt$a$b$c$dd$ee',
      'scrypt$16384$8$1$abce$ab',
      'scrypt$16384$8$1$aa$bb$extra',
    ]) {
      await expect(verifyScryptPassword(bad, 'x')).resolves.toBe(false);
    }
  });

  it('treats an absurd N as a bad hash without throwing', async () => {
    const salt = 'aa'.repeat(16);
    const expected = 'bb'.repeat(64);
    // N = 2**30 exceeds scrypt's maxBuffer; Node reports the failure via the callback error.
    await expect(
      verifyScryptPassword(`scrypt$1073741824$1$1$${salt}$${expected}`, 'x'),
    ).resolves.toBe(false);
  });

  it('rejects when the expected hash is the wrong length', async () => {
    const salt = 'aa'.repeat(16);
    await expect(verifyScryptPassword(`scrypt$16384$8$1$${salt}$bbbb`, 'x')).resolves.toBe(false);
  });

  it('treats non-power-of-2 N as a bad hash', async () => {
    const salt = 'aa'.repeat(16);
    const expected = 'bb'.repeat(64);
    await expect(verifyScryptPassword(`scrypt$3$8$1$${salt}$${expected}`, 'x')).resolves.toBe(
      false,
    );
  });

  it('verifies with different work factors', async () => {
    await expect(verifyScryptPassword(makeHash('s3cr3t', 4096, 4, 1), 's3cr3t')).resolves.toBe(
      true,
    );
  });
});
