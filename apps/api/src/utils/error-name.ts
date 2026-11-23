/**
 * Returns the name of an `Error`, or a fallback for any other thrown value.
 *
 * This keeps the existing log format for unknown values without turning them
 * into strings, which could expose their contents.
 * @param error - the thrown value to describe
 * @param fallback - text returned when `error` is not an `Error`
 * @returns `error.name` for `Error` instances, otherwise `fallback`
 * @example
 * ```ts
 * errorName(new TypeError('bad input')); // 'TypeError'
 * errorName({ name: 'FakeError' }); // 'unknown error'
 * errorName('boom', 'string'); // 'string'
 * ```
 */
export function errorName(error: unknown, fallback = 'unknown error'): string {
  return error instanceof Error ? error.name : fallback;
}
