import { describe, expect, it } from 'vitest';

import type { Database } from '../database/drizzle.module.js';

import { TranslationsService } from './translations.service.js';

const valid = {
  namespace: 'static',
  languageId: '123e4567-e89b-42d3-a456-426655440000',
  text: 'bonjour',
  key: 'greeting',
} as const;

function databaseReturning(returning: unknown, insertError?: unknown, updateError?: unknown) {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => {
          if (insertError) throw insertError;
          return returning;
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [
            {
              id: '123e4567-e89b-42d3-a456-426655440000',
              languageId: '123e4567-e89b-42d3-a456-426655440000',
              namespace: 'static',
              key: 'greeting',
              text: 'bonjour',
              parentId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            },
          ],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => {
            if (updateError) throw updateError;
            return returning;
          },
        }),
      }),
    }),
  } as unknown as Database;
}

describe('TranslationsService failure paths (stubbed database)', () => {
  it('create throws when RETURNING yields no row', async () => {
    const service = new TranslationsService(databaseReturning([]));
    await expect(service.create({ ...valid })).rejects.toThrow('insert returned no row');
  });

  it('create rethrows non-unique pg errors', async () => {
    const service = new TranslationsService(databaseReturning([], new Error('boom')));
    await expect(service.create({ ...valid })).rejects.toThrow('boom');
  });

  it('update maps pg unique violations to ConflictException', async () => {
    const unique = { cause: { code: '23505' } };
    const service = new TranslationsService(databaseReturning([{ id: 'x' }], undefined, unique));
    await expect(
      service.update('123e4567-e89b-42d3-a456-426655440000', { key: 'other' }),
    ).rejects.toThrow(/key already exists/);
  });

  it('update throws when RETURNING yields no row', async () => {
    const service = new TranslationsService(databaseReturning([]));
    await expect(
      service.update('123e4567-e89b-42d3-a456-426655440000', { text: 'after' }),
    ).rejects.toThrow('Translation not found');
  });

  it('update rethrows non-unique pg errors', async () => {
    const service = new TranslationsService(databaseReturning([], undefined, new Error('boom')));
    await expect(
      service.update('123e4567-e89b-42d3-a456-426655440000', { text: 'after' }),
    ).rejects.toThrow('boom');
  });
});
