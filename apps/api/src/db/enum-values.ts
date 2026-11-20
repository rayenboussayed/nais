/**
 * Copies a zod enum's `options` into the mutable, non-empty tuple that
 * drizzle's `pgEnum` requires. Zod types `options` as a plain `Array`, which
 * cannot satisfy drizzle's `[string, ...string[]]` constraint. Copying instead
 * of casting keeps zod's array storage from leaking into drizzle's mutable
 * tuple contract, and the guard makes the empty case impossible at runtime.
 * @param values - the zod enum's `options` array
 * @returns a mutable, non-empty tuple with the same values, in the same order
 */
export function toPgEnumValues<T extends string>(values: readonly T[]): [T, ...T[]] {
  const [first, ...rest] = values;
  if (first === undefined) {
    throw new Error('pgEnum requires at least one value');
  }
  return [first, ...rest];
}
