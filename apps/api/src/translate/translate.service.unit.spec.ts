import type { ConfigService } from '@nestjs/config';
import type { AiService } from '@nestjs/ai';
import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../database/drizzle.module';
import type { Env } from '../config/env';

import { TranslateService } from './translate.service';

const request = { text: 'hello', targetLanguage: 'fr' } as const;
const language = { id: 'lang-1', iso6391: 'fr', name: 'French' };

function mockSelectFactory(results: Array<Array<Record<string, unknown>>>) {
  let call = 0;
  return () => ({
    from: () => ({
      where: () => ({
        limit: async () => results[call++] ?? [],
      }),
    }),
  });
}

function configStub(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    OLLAMA_TEXT_MODEL: 'bonsai-2:2b',
    OLLAMA_TIMEOUT_MS: 60_000,
  };
  return {
    get: (key: string) => ({ ...base, ...overrides })[key],
  } as unknown as ConfigService<Env, true>;
}

function aiStub() {
  return {
    generateText: vi.fn(async () => ({
      text: '[fr] bonjour',
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        cachedInputTokens: 0,
        reasoningTokens: 0,
      },
    })),
  };
}

function buildDb({
  languageRow,
  cachedRow,
  finalRow,
  auditReturning,
}: {
  languageRow?: typeof language;
  cachedRow?: { text: string };
  finalRow?: { text: string };
  auditReturning: Array<{ id: string }>;
}) {
  return {
    select: mockSelectFactory([
      languageRow ? [languageRow as unknown as Record<string, unknown>] : [],
      cachedRow ? [cachedRow as unknown as Record<string, unknown>] : [],
      finalRow ? [finalRow as unknown as Record<string, unknown>] : [],
    ]),
    insert: () => ({
      values: () => ({
        returning: async () => auditReturning,
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        insert: () => ({
          values: () => ({
            onConflictDoNothing: async () => [],
            then: (onFulfilled?: (value: unknown) => unknown) =>
              Promise.resolve([]).then(onFulfilled ?? ((value) => value)),
          }),
        }),
        update: () => ({
          set: () => ({
            where: () => Promise.resolve([]),
          }),
        }),
      }),
    update: () => ({
      set: () => ({
        where: () => ({
          catch: () => Promise.resolve([]),
        }),
      }),
    }),
  } as unknown as Database;
}

describe('TranslateService.onModuleInit (stale processing reaper)', () => {
  function buildReaperDb(returning: unknown, updateError?: unknown) {
    return {
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

  it('logs and resolves when stale rows are reaped', async () => {
    const service = new TranslateService(
      buildReaperDb([{ id: 'a' }, { id: 'b' }]),
      aiStub() as unknown as AiService,
      configStub(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('swallows and logs a failing reaper without taking the boot down', async () => {
    const service = new TranslateService(
      buildReaperDb(undefined, new Error('permission denied')),
      aiStub() as unknown as AiService,
      configStub(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('resolves quietly when nothing stale exists', async () => {
    const service = new TranslateService(
      buildReaperDb([]),
      aiStub() as unknown as AiService,
      configStub(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });
});

describe('TranslateService (stubbed database and model)', () => {
  it('still reports the timeout even when the failure audit also fails', async () => {
    // The catch-all path updates aiMessages to 'failed' on error; if that
    // write itself fails, it is swallowed (audit is best-effort) and the
    // caller still gets the mapped error.
    const db = {
      ...buildDb({ languageRow: language, auditReturning: [{ id: 'msg-1' }] }),
      update: () => ({
        set: () => ({
          where: () => Promise.reject(new Error('update failed')),
        }),
      }),
    } as unknown as Database;
    const aiHanging = {
      generateText: vi.fn(async () => {
        throw new Error('operation timed out');
      }),
    } as unknown as AiService;

    const service = new TranslateService(db, aiHanging, configStub());
    await expect(service.translate({ ...request })).rejects.toThrow('Translation timed out');
  });

  it('aligns the audit response with the catalogue text when a race is lost', async () => {
    const auditSets: Array<Record<string, unknown>> = [];
    const db = {
      ...buildDb({
        languageRow: language,
        finalRow: { text: '[fr] winner from catalogue' },
        auditReturning: [{ id: 'msg-1' }],
      }),
      update: () => ({
        set: (value: Record<string, unknown>) => {
          auditSets.push(value);
          return {
            where: () => Promise.resolve([]),
          };
        },
      }),
    } as unknown as Database;

    const service = new TranslateService(db, aiStub() as unknown as AiService, configStub());
    const result = await service.translate({ ...request });

    expect(result.text).toBe('[fr] winner from catalogue');
    expect(auditSets.some((value) => value.response === '[fr] winner from catalogue')).toBe(true);
  });

  it('throws when the audit insert yields no row', async () => {
    const db = buildDb({ languageRow: language, auditReturning: [] });
    const service = new TranslateService(db, aiStub() as unknown as AiService, configStub());

    await expect(service.translate({ ...request })).rejects.toThrow(
      'ai_messages insert returned no row',
    );
  });

  it('returns the generated text even when the catalogue re-read finds nothing', async () => {
    const db = buildDb({ languageRow: language, auditReturning: [{ id: 'msg-1' }] });
    const service = new TranslateService(db, aiStub() as unknown as AiService, configStub());

    const result = await service.translate({ ...request });
    expect(result.text).toBe('[fr] bonjour');
    expect(result.cached).toBe(false);
  });

  it('returns the cached row without touching the model', async () => {
    const db = buildDb({
      languageRow: language,
      cachedRow: { text: '[fr] cached' },
      auditReturning: [],
    });
    const ai = aiStub();
    const service = new TranslateService(db, ai as unknown as AiService, configStub());

    const result = await service.translate({ ...request });
    expect(result).toEqual({ text: '[fr] cached', cached: true });
    expect(ai.generateText).not.toHaveBeenCalled();
  });
});
