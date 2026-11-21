import { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import type { Database } from '../db/drizzle.module.js';

import { aiMessages } from '../db/schema.js';
import { markAuditFailed } from './audit.js';

interface AuditCaptures {
  sets: Array<Record<string, unknown>>;
  tables: Array<unknown>;
  wheres: Array<unknown>;
}

/**
 * Minimal chainable database double for the single audit update.
 * @param whereResult - what the update chain's `where()` yields
 * @returns the database double plus buffers capturing the table, set payload and where predicate
 */
function dbDouble(whereResult: Promise<unknown>): { captures: AuditCaptures; db: Database } {
  const captures: AuditCaptures = { sets: [], tables: [], wheres: [] };
  const db = {
    update: (table: unknown) => {
      captures.tables.push(table);
      return {
        set: (value: Record<string, unknown>) => {
          captures.sets.push(value);
          return {
            where: (predicate: unknown) => {
              captures.wheres.push(predicate);
              return whereResult;
            },
          };
        },
      };
    },
  } as unknown as Database;
  return { captures, db };
}

describe('markAuditFailed', () => {
  it('updates the ai_messages row for the message with a fresh timestamp', async () => {
    const { captures, db } = dbDouble(Promise.resolve([]));
    const messages: Array<string> = [];

    await expect(
      markAuditFailed(db, 'msg-1', (message) => {
        messages.push(message);
      }),
    ).resolves.toBeUndefined();

    expect(captures.tables).toHaveLength(1);
    expect(captures.tables[0]).toBe(aiMessages);
    expect(captures.sets).toHaveLength(1);
    expect(captures.sets[0]).toMatchObject({ status: 'failed' });
    expect(captures.sets[0]?.updatedAt).toBeInstanceOf(Date);
    expect(captures.wheres).toHaveLength(1);
    expect(captures.wheres[0]).toBeInstanceOf(SQL);
    expect(messages).toEqual([]);
  });

  it('reports the error name and swallows a database rejection', async () => {
    const { db } = dbDouble(Promise.reject(new Error('permission denied')));
    const messages: Array<string> = [];

    await expect(
      markAuditFailed(db, 'msg-2', (message) => {
        messages.push(message);
      }),
    ).resolves.toBeUndefined();

    expect(messages).toEqual(['audit row msg-2 could not be marked failed: Error']);
  });

  it('reports unknown error when the rejection has no Error name', async () => {
    const { db } = dbDouble(Promise.reject({ code: 'E' }));
    const messages: Array<string> = [];

    await expect(
      markAuditFailed(db, 'msg-3', (message) => {
        messages.push(message);
      }),
    ).resolves.toBeUndefined();

    expect(messages).toEqual(['audit row msg-3 could not be marked failed: unknown error']);
  });
});
