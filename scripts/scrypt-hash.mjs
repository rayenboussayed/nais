// Generates a scrypt password hash in the BASIC_AUTH_PASSWORD_HASH format:
// scrypt$N$r$p$saltHex$hashHex
// Usage: node scripts/scrypt-hash.mjs --password 'secret'
import { randomBytes, scryptSync } from 'node:crypto';
import process from 'node:process';

const flagIndex = process.argv.indexOf('--password');
const password = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;

if (!password) {
  console.error('Usage: npm run auth:hash -- --password <password>');
  // eslint-disable-next-line n/no-process-exit -- CLI bin: non-zero exit signals failure to the caller
  process.exit(1);
}

const N = 16384;
const r = 8;
const p = 1;
const keyLength = 64;
const salt = randomBytes(16);
const derived = scryptSync(password, salt, keyLength, { N, p, r });

console.log(`scrypt$${N}$${r}$${p}$${salt.toString('hex')}$${derived.toString('hex')}`);
