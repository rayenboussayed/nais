import type { AiService } from '@nestjs/ai';
import type { ConfigService } from '@nestjs/config';

import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';
import type { Database } from '../database/drizzle.module.js';

import { TranslateService } from './translate.service.js';

const request = { targetLanguage: 'fr', text: 'hello' } as const;
const language = { id: 'lang-1', iso6391: 'fr', name: 'French' };

/**
 * Stubs the translate model call with a fixed French answer and canned usage.
 * @returns the AiService stub
 */
function aiStub() {
  return {
    generateText: vi.fn(async () => ({
      text: '[fr] bonjour',
      usage: {
        cachedInputTokens: 0,
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
        totalTokens: 2,
      },
    })),
  };
}

/**
 * Chainable DB double; only the chains the translate pipeline uses are stubbed.
 * @param root0 - the fixture set
 * @param root0.auditReturning - rows returned by the audit-insert chain
 * @param root0.cachedRow - the translations row a catalogue cache hit should see
 * @param root0.cachedRow.text - the catalogue text returned on a cache hit
 * @param root0.finalRow - the row the in-tx re-read sees after a lost race
 * @param root0.finalRow.text - the text the in-tx re-read returns
 * @param root0.languageRow - the language row for the iso lookup
 * @param root0.updateSets - captures update payloads for assertions
 * @returns the Database double
 */
function buildDb({
  auditReturning,
  cachedRow,
  finalRow,
  languageRow,
  updateSets,
}: {
  auditReturning: Array<{ id: string }>;
  cachedRow?: { text: string };
  finalRow?: { text: string };
  languageRow?: typeof language;
  /** Captures aiMessages set() payloads from inside the transaction. */
  updateSets?: Array<Record<string, unknown>>;
}) {
  return {
    insert: () => ({
      values: () => ({
        returning: async () => auditReturning,
      }),
    }),
    select: mockSelectFactory([
      languageRow ? [languageRow as unknown as Record<string, unknown>] : [],
      cachedRow ? [cachedRow as unknown as Record<string, unknown>] : [],
    ]),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(transactionStub({ finalRow, updateSets })),
    update: () => ({
      set: () => ({
        where: () => ({
          catch: () => Promise.resolve([]),
        }),
      }),
    }),
  } as unknown as Database;
}

/**
 * Stubs ConfigService with the env keys the pipeline reads.
 * @param overrides - env keys to override in the stubbed parsed config
 * @returns the ConfigService double
 */
function configStub(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    OLLAMA_TEXT_MODEL: 'bonsai-2:2b',
    OLLAMA_TIMEOUT_MS: 60_000,
  };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test stub: config keys are compile-time constants of the stub
    get: (key: string) => ({ ...base, ...overrides })[key],
  } as unknown as ConfigService<Env, true>;
}

/**
 * Select-chain factory mirroring drizzle's fluent API.
 * @param results - rows per select call, in call order
 * @returns the select double
 */
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

/**
 * Transaction-mock factory: drizzle's tx handle for the translate pipeline.
 * Extracted so buildDb does not nest callables more than five levels deep.
 * @param args - the per-call fixture
 * @param args.finalRow - the translations row the in-tx re-read sees after a lost race
 * @param args.updateSets - captures updates for assertions
 * @returns the tx double
 */
function transactionStub({
  finalRow,
  updateSets,
}: {
  // eslint-disable-next-line sonarjs/no-redundant-optional -- exactOptionalPropertyTypes: callers pass explicit undefined
  finalRow?: undefined | { text: string };
  // eslint-disable-next-line sonarjs/no-redundant-optional -- exactOptionalPropertyTypes: callers pass explicit undefined
  updateSets?: Array<Record<string, unknown>> | undefined;
}) {
  return {
    insert: () => ({
      values: () => ({
        // Model a lost race: no row returned; the in-tx select decides.
        onConflictDoNothing: () => ({
          returning: async () => [],
        }),
        then: (onFulfilled?: (value: unknown) => unknown) =>
          Promise.resolve([]).then(onFulfilled ?? ((value) => value)),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (finalRow ? [finalRow as unknown as Record<string, unknown>] : []),
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateSets?.push(value);
        return {
          where: () => Promise.resolve([]),
        };
      },
    }),
  };
}

describe('TranslateService.onModuleInit (stale processing reaper)', () => {
  /**
   * DB double for the stale-reaper path of onModuleInit.
   * @param returning - rows the reaper update resolves with
   * @param updateError - when set, the reaper throws this instead
   * @returns the Database double
   */
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

  it('swallows a reaper failure that is not an Error instance', async () => {
    const service = new TranslateService(
      buildReaperDb(undefined, 'a string, not an error'),
      aiStub() as unknown as AiService,
      configStub(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('swallows a failure-marking error that is not an Error instance', async () => {
    const db = {
      ...buildDb({ auditReturning: [{ id: 'msg-1' }], languageRow: language }),
      update: () => ({
        set: () => ({
          where: () => Promise.reject('a string, not an error'),
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
      ...buildDb({ auditReturning: [{ id: 'msg-1' }], languageRow: language }),
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
    const updateSets: Array<Record<string, unknown>> = [];
    const db = buildDb({
      auditReturning: [{ id: 'msg-1' }],
      finalRow: { text: '[fr] winner from catalogue' },
      languageRow: language,
      updateSets,
    });

    const service = new TranslateService(db, aiStub() as unknown as AiService, configStub());
    const result = await service.translate({ ...request });

    expect(result.text).toBe('[fr] winner from catalogue');
    expect(updateSets.some((value) => value.response === '[fr] winner from catalogue')).toBe(true);
  });

  it('throws when the audit insert yields no row', async () => {
    const db = buildDb({ auditReturning: [], languageRow: language });
    const service = new TranslateService(db, aiStub() as unknown as AiService, configStub());

    await expect(service.translate({ ...request })).rejects.toThrow(
      'ai_messages insert returned no row',
    );
  });

  it('returns the generated text even when the catalogue re-read finds nothing', async () => {
    const db = buildDb({ auditReturning: [{ id: 'msg-1' }], languageRow: language });
    const service = new TranslateService(db, aiStub() as unknown as AiService, configStub());

    const result = await service.translate({ ...request });
    expect(result.text).toBe('[fr] bonjour');
    expect(result.cached).toBe(false);
  });

  it('returns the cached row without touching the model', async () => {
    const db = buildDb({
      auditReturning: [],
      cachedRow: { text: '[fr] cached' },
      languageRow: language,
    });
    const ai = aiStub();
    const service = new TranslateService(db, ai as unknown as AiService, configStub());

    const result = await service.translate({ ...request });
    expect(result).toEqual({ cached: true, text: '[fr] cached' });
    expect(ai.generateText).not.toHaveBeenCalled();
  });
});
