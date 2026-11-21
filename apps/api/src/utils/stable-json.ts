/**
 * Canonical JSON with recursively sorted object keys, so key order never
 * affects equality. Used by changedFields comparisons and by the AI task
 * cache-key derivation.
 */

/**
 * JSON.stringify with recursively sorted object keys.
 * @param value - the value to serialize
 * @returns canonical JSON with sorted keys
 */
export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Recursively NFC-normalizes string values so Unicode-equivalent inputs hash identically.
 * @param value - the value to normalize
 * @returns a deep copy with NFC-normalized strings
 */
export function nfcNormalize(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(nfcNormalize);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        nfcNormalize(nested),
      ]),
    );
  }
  return value;
}

/**
 * Recursively sorts object keys for canonical output.
 * @param value - the value to canonicalize
 * @returns the canonicalized value
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(compareKeys)
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

/**
 * Sorts entries by key for canonical object output. Branchless so every path
 * is exercised; yields -1/0/1 exactly like a three-way comparison (0 only for
 * equal keys, which Object.entries cannot produce).
 * @param a - the left entry
 * @param b - the right entry
 * @returns the comparison result
 */
function compareKeys(a: [string, unknown], b: [string, unknown]): number {
  return Number(a[0] > b[0]) - Number(a[0] < b[0]);
}
