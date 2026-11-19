import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, getTableColumns, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { AiMessage, AiMessagePrompt, KeysetList, Pagination } from '@trainslator/shared';

import { DRIZZLE } from '../database/drizzle.module.js';
import type { Database } from '../database/drizzle.module.js';
import { aiMessages, aiMessagePrompts } from '../database/schema.js';

import { escapeLike, keysetPage, keysetWhere, timestamptzCursor } from '../common/sql.js';

/** Row shape of the ai_messages table; mirrors `ai_messages` in drizzle/schema.ts. */
type AiMessageRow = typeof aiMessages.$inferSelect;

function rowToAiMessage(row: AiMessageRow): AiMessage {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    status: row.status,
    response: row.response,
    usage: row.usage ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
  };
}

function rowToPrompt(row: typeof aiMessagePrompts.$inferSelect): AiMessagePrompt {
  return {
    id: row.id,
    messageId: row.messageId,
    role: row.role,
    prompt: row.prompt,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Audit log for model calls; exposes list/detail/delete and nothing else. */
@Injectable()
export class AiMessagesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Lists AI messages with keyset pagination on `(createdAt, id)`.
   * `q` searches provider, model and response text (LIKE-escaped).
   *
   * @param params - pageSize, ordering, cursor and filters from the request query
   */
  async findPage(params: Pagination): Promise<KeysetList<AiMessage>> {
    const { q, lastId, lastCreatedAt, pageSize, orderBy, onlyDeleted } = params;
    const conditions: SQL[] = [
      onlyDeleted ? isNotNull(aiMessages.deletedAt) : isNull(aiMessages.deletedAt),
    ];

    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      conditions.push(
        sql`(${aiMessages.provider} ilike ${pattern} or ${aiMessages.model} ilike ${pattern} or ${aiMessages.response} ilike ${pattern})`,
      );
    }

    const cursor = keysetWhere(aiMessages.createdAt, aiMessages.id, orderBy, lastCreatedAt, lastId);
    if (cursor) conditions.push(cursor);

    const orderColumn = orderBy === 'asc' ? asc(aiMessages.createdAt) : desc(aiMessages.createdAt);
    const orderId = orderBy === 'asc' ? asc(aiMessages.id) : desc(aiMessages.id);

    const rows = await this.db
      .select({
        ...getTableColumns(aiMessages),
        createdAtCursor: timestamptzCursor(aiMessages.createdAt),
      })
      .from(aiMessages)
      .where(and(...conditions))
      .orderBy(orderColumn, orderId)
      .limit(pageSize + 1);

    return keysetPage(rows, pageSize, rowToAiMessage);
  }

  /**
   * @param id - uuid of the message row
   * @throws NotFoundException when missing or soft-deleted
   */
  async findOne(id: string): Promise<AiMessage> {
    const rows = await this.db
      .select()
      .from(aiMessages)
      .where(and(eq(aiMessages.id, id), isNull(aiMessages.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundException('AI message not found');
    return rowToAiMessage(row);
  }

  /**
   * Lists the prompts captured for one message (system/human/output roles), oldest first.
   *
   * @param id - uuid of the owning message
   * @throws NotFoundException when the message is missing or soft-deleted
   */
  async findPrompts(id: string): Promise<AiMessagePrompt[]> {
    await this.findOne(id);
    const rows = await this.db
      .select()
      .from(aiMessagePrompts)
      .where(eq(aiMessagePrompts.messageId, id))
      .orderBy(asc(aiMessagePrompts.createdAt));
    return rows.map(rowToPrompt);
  }

  /**
   * Soft-deletes a message.
   *
   * @throws NotFoundException when missing or already deleted
   */
  async remove(id: string): Promise<void> {
    const rows = await this.db
      .update(aiMessages)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(aiMessages.id, id), isNull(aiMessages.deletedAt)))
      .returning({ id: aiMessages.id });
    if (rows.length === 0) throw new NotFoundException('AI message not found');
  }
}
