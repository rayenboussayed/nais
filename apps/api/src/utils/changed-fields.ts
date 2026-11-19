import { canonicalJsonStringify } from './stable-json.js';

/**
 * Computes the subset of `patch` that actually differs from `before`.
 * `undefined` values mean "not provided" and are ignored; everything else is
 * compared by value (Dates by timestamp, objects by stable JSON). Returns an
 * empty object when nothing changed.
 * @param before - the current row shape
 * @param patch - the candidate partial update
 * @returns the subset of patch that actually differs
 */
export function changedFields<T extends Record<string, unknown>>(
  before: T,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const changed: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    // Only keys of the before-shape are ever forwarded: no prototype keys,
    // no unknown keys, even if a caller hands over an unvalidated patch.
    if (!Object.prototype.hasOwnProperty.call(before, key)) continue;
    if (value === undefined) continue;
    // eslint-disable-next-line security/detect-object-injection -- key is a whitelisted own key of the `before` object two lines up
    if (!valuesEqual(before[key], value)) changed[key] = value;
  }
  return changed;
}

/**
 * Value equality with Date/object awareness.
 * @param a - the before value
 * @param b - the patched value
 * @returns true when the values are equal
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a === 'object' || typeof b === 'object') {
    return canonicalJsonStringify(a) === canonicalJsonStringify(b);
  }
  return Object.is(a, b);
}
