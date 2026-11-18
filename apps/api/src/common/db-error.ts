/**
 * True when the error (or its cause chain) is a PostgreSQL unique-violation
 * (23505), which drizzle wraps in a DrizzleQueryError with the pg error as
 * `cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let hop = 0; hop < 10; hop += 1) {
    if (typeof current !== 'object' || current === null) return false;
    const code = (current as { code?: unknown }).code;
    if (code === '23505') return true;
    const next = (current as { cause?: unknown }).cause;
    if (next === undefined || next === current) return false;
    current = next;
  }
  return false;
}
