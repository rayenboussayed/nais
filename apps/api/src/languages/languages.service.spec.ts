import { describe, expect, it } from 'vitest';

import type { Database } from '../database/drizzle.module';

import { LanguagesService } from './languages.service';

const valid = {
  name: 'Testese',
  nativeName: 'Teste',
  iso6391: 'tz',
  dir: 'ltr',
  isSource: false,
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
              name: 'Before',
              nativeName: 'Before',
              iso6391: 'tz',
              dir: 'ltr',
              isSource: false,
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

describe('LanguagesService failure paths (stubbed database)', () => {
  it('create throws when RETURNING yields no row', async () => {
    const service = new LanguagesService(databaseReturning([]));
    await expect(service.create(valid)).rejects.toThrow('insert returned no row');
  });

  it('create rethrows non-unique pg errors', async () => {
    const service = new LanguagesService(databaseReturning([], new Error('boom')));
    await expect(service.create(valid)).rejects.toThrow('boom');
  });

  it('update maps pg unique violations to ConflictException', async () => {
    const unique = { cause: { code: '23505' } };
    const service = new LanguagesService(databaseReturning([{ id: 'x' }], undefined, unique));
    await expect(
      service.update('123e4567-e89b-42d3-a456-426655440000', { iso6391: 'de' }),
    ).rejects.toThrow(/ISO 639-1/);
  });

  it('update throws when RETURNING yields no row', async () => {
    const service = new LanguagesService(databaseReturning([]));
    await expect(
      service.update('123e4567-e89b-42d3-a456-426655440000', { name: 'After' }),
    ).rejects.toThrow('update returned no row');
  });

  it('update rethrows non-unique pg errors', async () => {
    const service = new LanguagesService(databaseReturning([], undefined, new Error('boom')));
    await expect(
      service.update('123e4567-e89b-42d3-a456-426655440000', { name: 'After' }),
    ).rejects.toThrow('boom');
  });
});
