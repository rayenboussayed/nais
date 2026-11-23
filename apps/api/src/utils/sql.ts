import type { Column, SQL } from 'drizzle-orm';

import { asc, desc, isNotNull, isNull, sql } from 'drizzle-orm';

import type { KeysetList } from '../schemas/list.js';

/**
 * Escapes user input for use inside a LIKE/ILIKE pattern with `ESCAPE '\'`.
 * Backslashes are doubled first, then `%` and `_` are escaped.
 * @param value - the raw user-supplied search term
 * @returns the term escaped for a LIKE/ILIKE pattern with `ESCAPE '\'`
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
 * @param column - the timestamptz column to render
 * @returns the microsecond-precision ISO-8601 text of the column
 */
export const timestamptzCursor = (column: Column) =>
  sql<string>`to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.USOF')`;

/**
 * Builds the shared `WHERE` conditions of the admin list services. The
 * soft-delete predicate is always first, followed by the caller's `extra`
 * filters and finally the keyset `cursor` when one is present. Keeping this
 * order makes the generated SQL identical to the hand-written scaffolding.
 * A fresh array is returned; `extra` is never mutated.
 * @param deletedAt - the table's soft-delete (`deleted_at`) column
 * @param onlyDeleted - select only soft-deleted rows instead of only live rows
 * @param cursor - keyset comparator from `keysetWhere`, or undefined on the first page
 * @param extra - additional domain filters such as equality or ILIKE predicates
 * @returns the ordered conditions to spread into `and(...)`
 */
export function buildListConditions(
  deletedAt: Column,
  onlyDeleted: boolean,
  cursor: SQL | undefined,
  extra: SQL[],
): SQL[] {
  return [
    onlyDeleted ? isNotNull(deletedAt) : isNull(deletedAt),
    ...extra,
    ...(cursor ? [cursor] : []),
  ];
}

/**
 * Shared tail of the keyset-paginated list services. Callers pass the
 * `pageSize + 1` rows selected with `createdAtCursor: timestamptzCursor(...)`;
 * this slices the page, computes `hasMore` and the opaque cursor pair.
 * @param rows - the `pageSize + 1` rows selected with `timestamptzCursor`
 * @param pageSize - the maximum number of items to return
 * @param map - maps a row to the wire item
 * @returns the keyset-paginated page
 */
export function keysetPage<Row extends { createdAtCursor: string; id: string }, Item>(
  rows: Row[],
  pageSize: number,
  map: (row: Row) => Item,
): KeysetList<Item> {
  const page = rows.slice(0, pageSize);
  const hasMore = rows.length > pageSize;
  const lastRow = page[page.length - 1];
  return {
    items: page.map(map),
    next:
      hasMore && lastRow ? { lastCreatedAt: lastRow.createdAtCursor, lastId: lastRow.id } : null,
  };
}

/**
 * Row-value keyset comparator for keyset pagination ordered by
 * `(createdAt, id)`; pairs with the client cursor `{ lastCreatedAt, lastId }`.
 * @param column - the table's created_at column
 * @param id - the table's id column
 * @param orderBy - direction of the ordering
 * @param lastCreatedAt - cursor value from the previous page, or undefined for the first page
 * @param lastId - cursor value from the previous page, or undefined for the first page
 * @returns the row-value comparator SQL fragment
 * @throws Error when only one of the two cursor values is supplied — a partial cursor would silently restart pagination
 */
export function keysetWhere(
  column: Column,
  id: Column,
  orderBy: 'asc' | 'desc',
  lastCreatedAt: string | undefined,
  lastId: string | undefined,
) {
  if (!lastCreatedAt && !lastId) return undefined;
  if (!lastCreatedAt || !lastId) {
    throw new Error('keyset cursor requires both lastCreatedAt and lastId');
  }
  return orderBy === 'asc'
    ? sql`(${column}, ${id}) > (${lastCreatedAt}::timestamptz, ${lastId}::uuid)`
    : sql`(${column}, ${id}) < (${lastCreatedAt}::timestamptz, ${lastId}::uuid)`;
}

/**
 * Builds the `ORDER BY` expressions shared by the keyset-paginated lists:
 * `createdAt` first and `id` as the unique tie-break, both in the requested
 * direction.
 * @param createdAt - the table's `created_at` column
 * @param id - the table's unique `id` column used as the tie-break
 * @param orderBy - direction of the ordering
 * @returns the `[createdAt, id]` ordering pair to spread into `.orderBy(...)`
 */
export function orderByColumns(createdAt: Column, id: Column, orderBy: 'asc' | 'desc'): [SQL, SQL] {
  return orderBy === 'asc' ? [asc(createdAt), asc(id)] : [desc(createdAt), desc(id)];
}
