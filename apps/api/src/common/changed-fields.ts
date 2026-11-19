/**
 * Computes the subset of `patch` that actually differs from `before`.
 * `undefined` values mean "not provided" and are ignored; everything else is
 * compared by value (Dates by timestamp, objects by stable JSON). Returns an
 * empty object when nothing changed.
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
    if (!valuesEqual(before[key], value)) changed[key] = value;
  }
  return changed;
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a === 'object' || typeof b === 'object') {
    return canonicalJson(a) === canonicalJson(b);
  }
  return Object.is(a, b);
}

/** JSON with recursively sorted object keys, so key order never affects equality. */
function canonicalJson(value: unknown): string {
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
