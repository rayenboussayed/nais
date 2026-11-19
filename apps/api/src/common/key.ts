import { createHash } from 'node:crypto';

import { canonicalJsonStringify, nfcNormalize } from './stable-json';

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

/**
 * Derives the cache key for a general AI task invocation:
 * sha512 of `task + model + canonical JSON of the input`, base64url-encoded.
 *
 * @param task - AI task name (e.g. `sentiment`)
 * @param model - effective model id the pipeline will use
 * @param input - canonicalized task input
 */
export function taskKeyFor(task: string, model: string, input: unknown): string {
  const canonical = canonicalJsonStringify(nfcNormalize(input));
  return createHash('sha512')
    .update(`${task}:${model}:${canonical}`, 'utf8')
    .digest()
    .toString('base64url');
}

/** sha512 of the NFC-normalized canonical input; used for privacy-preserving audit payloads. */
export function inputHashFor(input: unknown): string {
  return createHash('sha512').update(canonicalJsonStringify(nfcNormalize(input)), 'utf8').digest('base64url');
}
