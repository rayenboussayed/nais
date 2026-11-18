import { sql } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';

/**
 * Escapes user input for use inside a LIKE/ILIKE pattern with `ESCAPE '\'`.
 * Backslashes are doubled first, then `%` and `_` are escaped.
 */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Microsecond-precision ISO-8601 text of a timestamptz column
 * (`2026-11-18T23:05:21.809035+00:00`). JS `Date` only carries milliseconds,
 * so cursors derived from `.toISOString()` silently lose the sub-millisecond
 * digits Postgres stores — which is enough to let the anchor row of a keyset
 * page pass `>` again. Cursor values must always come from this expression.
 * `to_char` is immune to session `DateStyle`, unlike a `::text` cast.
 */
export const timestamptzCursor = (column: Column) =>
  sql<string>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.USOF')`;

/**
 * Row-value keyset comparator for keyset pagination ordered by
 * `(createdAt, id)`; pairs with the client cursor `{ lastCreatedAt, lastId }`.
 *
 * @param column - the table's created_at column
 * @param id - the table's id column
 * @param orderBy - direction of the ordering
 * @param lastCreatedAt - cursor value from the previous page, or undefined for the first page
 * @param lastId - cursor value from the previous page, or undefined for the first page
 */
export function keysetWhere(
  column: Column,
  id: Column,
  orderBy: 'asc' | 'desc',
  lastCreatedAt: string | undefined,
  lastId: string | undefined,
) {
  if (!lastCreatedAt || !lastId) return undefined;
  return orderBy === 'asc'
    ? sql`(${column}, ${id}) > (${lastCreatedAt}::timestamptz, ${lastId}::uuid)`
    : sql`(${column}, ${id}) < (${lastCreatedAt}::timestamptz, ${lastId}::uuid)`;
}
