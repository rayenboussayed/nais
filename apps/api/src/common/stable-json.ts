/**
 * Canonical JSON with recursively sorted object keys, so key order never
 * affects equality. Used by changedFields comparisons and by the AI task
 * cache-key derivation.
 */

/** JSON.stringify with recursively sorted object keys. */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

/** Recursively NFC-normalizes string values so Unicode-equivalent inputs hash identically. */
export function nfcNormalize(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(nfcNormalize);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, nfcNormalize(nested)]),
    );
  }
  return value;
}
