import type { AiMessage as AiMessageWire } from '@trainslator/shared';

import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { isNull } from 'drizzle-orm';

/**
 * Drizzle schema for the translation service. This file is the single source
 * of truth for table and column definitions; TS row types come from
 * `$inferSelect` / `$inferInsert` and are re-exported at the bottom.
 *
 * Conventions: exclusive-utc `timestamptz` everywhere, soft delete via
 * `deleted_at` (reads filter `deleted_at IS NULL`), no cascades except
 * ai_message_prompts owned by ai_messages.
 */

export const languageDirEnum = pgEnum('language_dir', ['ltr', 'rtl']);
export const translationNamespaceEnum = pgEnum('translation_namespace', ['static', 'dynamic']);
export const aiMessageStatusEnum = pgEnum('ai_message_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

/** ISO 639-1 catalogue of languages; seeded at boot (see seed.ts). */
export const languages = pgTable(
  'languages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    nativeName: varchar('native_name', { length: 255 }).notNull(),
    iso6391: varchar('iso639_1', { length: 2 }).notNull(),
    dir: languageDirEnum('dir').notNull(),
    isSource: boolean('is_source').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  // All three admin lists keyset-paginate on (created_at, id); keep the plan index-only.
  (table) => [
    uniqueIndex('languages_iso639_1_unique').on(table.iso6391),
    index('languages_created_at_id_idx').on(table.createdAt, table.id),
  ],
);

/**
 * Translatable strings, one row per (language, key). `dynamic` rows are
 * produced by the AI translate pipeline with a sha512 key; `static` rows
 * carry a human-authored key. `parent_id` links variants of the same source
 * string across namespaces.
 */
export const translations = pgTable(
  'translations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    languageId: uuid('language_id')
      .notNull()
      .references(() => languages.id),
    namespace: translationNamespaceEnum('namespace').notNull().default('dynamic'),
    /** sha512 base64url of the NFC-normalized text for `dynamic` rows; human slug for `static`. */
    key: varchar('key', { length: 255 }).notNull(),
    text: text('text').notNull(),
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    // Partial: a soft-deleted row stops occupying the slot; the next write re-creates it.
    uniqueIndex('translations_language_key_unique')
      .on(table.languageId, table.key)
      .where(isNull(table.deletedAt)),
    index('translations_language_namespace_created_idx').on(
      table.languageId,
      table.namespace,
      table.createdAt,
    ),
    index('translations_created_at_id_idx').on(table.createdAt, table.id),
    foreignKey({
      columns: [table.parentId],
      foreignColumns: [table.id],
      name: 'translations_parent_fk',
    }).onDelete('set null'),
  ],
);

/** Audit log for AI provider calls. Internal write path only. */
export const aiMessages = pgTable(
  'ai_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Which AI task produced this call; 'translate' predates the general service. */
    task: varchar('task', { length: 64 }).notNull().default('translate'),
    provider: varchar('provider', { length: 50 }).notNull().default('ollama'),
    model: varchar('model', { length: 50 }).notNull(),
    /** Serialized task input (text/context/question…); text payloads live in the prompts rows too. */
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    status: aiMessageStatusEnum('status').notNull().default('pending'),
    /** Final text returned by the model; null until it answers or on failure. */
    response: text('response'),
    /** Token/cost accounting as reported by the provider (jsonb). */
    usage: jsonb('usage').$type<AiMessageWire['usage']>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [index('ai_messages_created_at_id_idx').on(table.createdAt, table.id)],
);

/**
 * Model-output cache for the general AI pipeline: one row per
 * (task, model, input hash). Soft-delete keeps the slot reusable.
 */
export const aiCache = pgTable(
  'ai_cache',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    task: varchar('task', { length: 64 }).notNull(),
    model: varchar('model', { length: 255 }).notNull(),
    /** sha512 base64url of the NFC-normalized canonical input JSON. */
    key: varchar('key', { length: 255 }).notNull(),
    /** Task-shaped result object (validated by the caller against the task's result schema). */
    result: jsonb('result').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('ai_cache_task_model_key_unique')
      .on(table.task, table.model, table.key)
      .where(isNull(table.deletedAt)),
    index('ai_cache_task_created_at_idx').on(table.task, table.createdAt),
  ],
);

/** Individual prompts exchanged during an AI call (system, human, output). Owned by ai_messages. */
export const aiMessagePrompts = pgTable(
  'ai_message_prompts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => aiMessages.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 10 }).notNull(),
    prompt: text('prompt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('ai_message_prompts_message_idx').on(table.messageId)],
);

export type AiCache = typeof aiCache.$inferSelect;
export type NewAiCache = typeof aiCache.$inferInsert;
export type Language = typeof languages.$inferSelect;
export type NewLanguage = typeof languages.$inferInsert;
export type Translation = typeof translations.$inferSelect;
export type NewTranslation = typeof translations.$inferInsert;
export type AiMessage = typeof aiMessages.$inferSelect;
export type NewAiMessage = typeof aiMessages.$inferInsert;
export type AiMessagePrompt = typeof aiMessagePrompts.$inferSelect;
export type NewAiMessagePrompt = typeof aiMessagePrompts.$inferInsert;
