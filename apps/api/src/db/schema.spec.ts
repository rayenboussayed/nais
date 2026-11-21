import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import {
  aiMessageStatusSchema,
  languageDirSchema,
  translationNamespaceSchema,
} from '../schemas/enums.js';
import {
  aiMessagePrompts,
  aiMessages,
  aiMessageStatusEnum,
  languageDirEnum,
  languages,
  translationNamespaceEnum,
  translations,
} from './schema.js';

/**
 * Resolves the tables through drizzle's own config extractor (the same path
 * drizzle-kit uses) so the extraConfig callbacks (indexes, foreign keys) are
 * executed and their constraint names — which migrations and plans depend on
 * — are pinned by tests.
 */
describe('drizzle schema invariants', () => {
  it('pgEnums derive their names and values from the shared zod enums', () => {
    expect(languageDirEnum.enumName).toBe('language_dir');
    expect(translationNamespaceEnum.enumName).toBe('translation_namespace');
    expect(aiMessageStatusEnum.enumName).toBe('ai_message_status');

    expect([...languageDirEnum.enumValues]).toEqual([...languageDirSchema.options]);
    expect([...translationNamespaceEnum.enumValues]).toEqual([
      ...translationNamespaceSchema.options,
    ]);
    expect([...aiMessageStatusEnum.enumValues]).toEqual([...aiMessageStatusSchema.options]);
  });

  it('languages has a unique iso639_1 index', () => {
    const config = getTableConfig(languages);
    const names = config.indexes.map((index) => index.config.name);
    expect(names).toContain('languages_iso639_1_unique');
    expect(
      config.indexes.find((index) => index.config.name === 'languages_iso639_1_unique')?.config
        .unique,
    ).toBe(true);
  });

  it('translations has the unique (language_id, key) index and the lookup index', () => {
    const config = getTableConfig(translations);
    const names = config.indexes.map((index) => index.config.name);
    expect(names).toContain('translations_language_key_unique');
    expect(names).toContain('translations_language_namespace_created_idx');
    expect(
      config.indexes.find((index) => index.config.name === 'translations_language_key_unique')
        ?.config.unique,
    ).toBe(true);
  });

  it('translations.parent_id self-FK points at translations.id', () => {
    const config = getTableConfig(translations);
    const parent = config.foreignKeys.find(
      (fk) => fk.reference().name === 'translations_parent_fk',
    );
    expect(parent).toBeDefined();
    expect(parent?.reference().columns.map((column) => column.name)).toEqual(['parent_id']);
    expect(parent?.reference().foreignColumns.map((column) => column.name)).toEqual(['id']);
  });

  it('ai_message_prompts references ai_messages(id)', () => {
    const config = getTableConfig(aiMessagePrompts);
    const fk = config.foreignKeys[0];
    expect(fk?.reference().foreignColumns.map((column) => column.name)).toEqual(['id']);
  });

  it('ai_messages, translations and languages have the (created_at, id) keyset index', () => {
    expect(getTableConfig(aiMessages).indexes.map((index) => index.config.name)).toContain(
      'ai_messages_created_at_id_idx',
    );
    expect(getTableConfig(translations).indexes.map((index) => index.config.name)).toContain(
      'translations_created_at_id_idx',
    );
    expect(getTableConfig(languages).indexes.map((index) => index.config.name)).toContain(
      'languages_created_at_id_idx',
    );
  });
});
