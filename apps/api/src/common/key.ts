import { createHash } from 'node:crypto';

/**
 * Stable translation key for dynamic rows: sha512 of the NFC-normalized,
 * trimmed text, encoded as base64url (filename/URL-safe). The legacy service
 * hashed the raw text, so canonically-equivalent strings missed the cache;
 * NFC normalization removes that miss class.
 */
export function translationKeyFor(text: string): string {
  const normalized = text.normalize('NFC').trim();
  return createHash('sha512').update(normalized).digest('base64url');
}
