import { scrypt, timingSafeEqual } from 'node:crypto';

const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;

/**
 * Fixed, well-formed scrypt hash of a throwaway input. Used to run the KDF
 * with the same cost when the configured hash is missing or the candidate
 * username does not match, so wrong-name and missing-configuration 401s are
 * indistinguishable from a wrong-password 401.
 */
export const DUMMY_SCRYPT_HASH =
  'scrypt$16384$8$1$5a9927be89f6a9d7173d12fc20754f3e$572f5b62505f05add98f2e3445ff9b77fa8f9c5d535a99ce69aa4810a79f156190c16a739d36f2dcce1f7c7fe79cd613f7f147abf0fa7a894757fac286459d69';

function scryptBuffer(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, { N: n, r, p }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/**
 * Verifies a password against a `scrypt$N$r$p$saltHex$hashHex` hash.
 * Runs the KDF off the event loop; a bad hash behaves exactly like a wrong
 * password. Never throws.
 */
export async function verifyScryptPassword(storedHash: string, password: string): Promise<boolean> {
  const parts = storedHash.split('$');
  if (parts.length !== 6) return false;
  const [prefix, nRaw, rRaw, pRaw, saltHex, hashHex] = parts;
  if (prefix !== HASH_PREFIX || !nRaw || !rRaw || !pRaw || !saltHex || !hashHex) {
    return false;
  }

  const n = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  if (n < 2 || r < 1 || p < 1) return false;
  if (saltHex.length % 2 !== 0 || hashHex.length % 2 !== 0) return false;

  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEY_LENGTH) return false;

  try {
    const actual = await scryptBuffer(password, salt, n, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    // Non-power-of-2 N or absurd parameters make scrypt throw; treat as a bad hash.
    return false;
  }
}
