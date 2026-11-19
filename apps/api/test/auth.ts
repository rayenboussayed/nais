import { scryptSync } from 'node:crypto';

const SALT = 'ab'.repeat(16);
const PASSWORD = 'admin-password';

/** Fast work factor for tests; 16384 does not buy anything for throwaway credentials. */
const HASH = `scrypt$1024$8$1$${SALT}$${scryptSync(PASSWORD, Buffer.from(SALT, 'hex'), 64, {
  N: 1024,
  r: 8,
  p: 1,
}).toString('hex')}`;

/** Env values pinning the test credential. Set in beforeAll of every integration spec. */
export const TEST_BASIC_AUTH_ENV: Record<string, string> = {
  BASIC_AUTH_USERNAME: 'admin',
  BASIC_AUTH_PASSWORD_HASH: HASH,
  SESSION_SECRET: 'a'.repeat(64),
};

/** Authorization headers matching TEST_BASIC_AUTH_ENV. */
export function basicAuthHeaders(): { authorization: string } {
  return {
    authorization: `Basic ${Buffer.from(`admin:${PASSWORD}`).toString('base64')}`,
  };
}
