import type { ConfigService } from '@nestjs/config';

import { BadGatewayException, GatewayTimeoutException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '../config/env.js';
import type { Database } from '../database/drizzle.module.js';
import type { TranslateService } from '../translate/translate.service.js';
import type { PipelineLoader } from './pipeline-loader.js';

import { AiService } from './ai.service.js';

/**
 * Stubs ConfigService with the env keys the pipeline reads.
 * @param overrides - env keys to override in the stubbed parsed config
 * @returns a minimal ConfigService double
 */
function configStub(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    AI_MAX_CONCURRENCY: 2 as never, // validateEnv coerces in production; here we stub the parsed value
    OLLAMA_TEXT_MODEL: 'bonsai-2:2b',
    ...overrides,
  };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test stub: config keys are compile-time constants of the stub
    get: (key: string) => base[key],
  } as unknown as ConfigService<Env, true>;
}

/**
 * Minimal chainable DB double; only the chains the pipeline uses are stubbed.
 * @param root0 - the fixture set
 * @param root0.cacheRows - rows served by the ai_cache select chain
 * @param root0.auditReturning - rows returned by the audit-insert chain
 * @param root0.txInsertReturning - what the in-tx insert returns ([] models a lost race)
 * @param root0.txWinnerRow - the AI-cache row the in-tx re-read sees after a lost race
 * @param root0.txWinnerRow.result - the winner's result payload
 * @returns the Database double (carrying auditSets for assertions)
 */
function dbStub({
  auditReturning = [{ id: 'msg-1' }],
  cacheRows = [],
  txInsertReturning = [{ id: 'cache-1' }],
  txWinnerRow,
}: {
  auditReturning?: Array<{ id: string }>;
  cacheRows?: Array<Record<string, unknown>>;
  /** What ai_cache.insert().onConflictDoNothing().returning() yields ([] models a lost race). */
  txInsertReturning?: Array<{ id: string }>;
  /** The AI-cache row the in-tx re-read sees after a lost race. */
  txWinnerRow?: { result: Record<string, unknown> };
} = {}) {
  const auditSets: Array<Record<string, unknown>> = [];
  return {
    auditSets,
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => [],
        returning: async () => auditReturning,
        then: (onFulfilled?: (v: unknown) => unknown) =>
          Promise.resolve([]).then(onFulfilled ?? ((v: unknown) => v)),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => cacheRows,
        }),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn(transactionStub({ auditSets, txInsertReturning, txWinnerRow })),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        auditSets.push(value);
        return {
          where: () => Object.assign(Promise.resolve([]), { catch: () => Promise.resolve([]) }),
        };
      },
    }),
  } as unknown as Database & { auditSets: Array<Record<string, unknown>> };
}

/**
 * Task-shaped request payload for the registry-driven table test.
 * @param task - the task id from the table
 * @returns the request payload matching the task's input contract
 */
function payloadForTask(task: string) {
  if (task === 'question-answering') return { context: 'c', question: 'q' };
  if (task === 'zero-shot-classification') return { candidateLabels: ['a', 'b'], text: 't' };
  return { text: 't' };
}

/**
 * Loader stub: every load resolves to a pipeline returning `output`.
 * @param output - the fixed model output each pipeline invocation returns
 * @param model - the model id the stub reports
 * @returns the PipelineLoader stub
 */
function pipelineLoader(output: unknown, model = 'test/model') {
  return {
    load: vi.fn(async () => async () => output),
    modelFor: () => model,
  } as unknown as PipelineLoader;
}

/**
 * Transaction-mock factory: drizzle's tx handle for the AI pipeline.
 * Extracted so dbStub does not nest callables more than five levels deep.
 * @param args - the per-call fixture
 * @param args.auditSets - captures ai_messages updates for assertions
 * @param args.txInsertReturning - what the in-tx insert returns ([] models a lost race)
 * @param args.txWinnerRow - the AI-cache row the in-tx re-read sees after a lost race
 * @returns the tx double
 */
function transactionStub({
  auditSets,
  txInsertReturning,
  txWinnerRow,
}: {
  auditSets: Array<Record<string, unknown>>;
  txInsertReturning: Array<{ id: string }>;
  // eslint-disable-next-line sonarjs/no-redundant-optional -- exactOptionalPropertyTypes: callers pass explicit undefined
  txWinnerRow?: undefined | { result: Record<string, unknown> };
}) {
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => txInsertReturning,
        }),
        then: (onFulfilled?: (v: unknown) => unknown) =>
          Promise.resolve([]).then(onFulfilled ?? ((v: unknown) => v)),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (txWinnerRow ? [txWinnerRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        auditSets.push(value);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
}

describe('AiService.run', () => {
  it('rejects an unknown task with 404', async () => {
    const service = new AiService(
      dbStub(),
      {} as unknown as TranslateService,
      pipelineLoader([]),
      configStub(),
    );
    await expect(service.run('definitely-not-a-task', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('serves a cache hit without loading the pipeline', async () => {
    const db = dbStub({ cacheRows: [{ result: { label: 'POSITIVE', score: 0.99 } }] });
    const loader = pipelineLoader([{ label: 'POSITIVE', score: 0.1 }]);
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('sentiment', { text: 'I love this' });
    expect(result).toMatchObject({ cached: true, task: 'sentiment' });
    expect(result.result).toMatchObject({ cached: true, label: 'POSITIVE' });
    expect(loader.load).not.toHaveBeenCalled();
  });

  it('runs the pipeline on a miss and persists audit + cache rows', async () => {
    const db = dbStub();
    const loader = pipelineLoader([{ label: 'POSITIVE', score: 0.91 }]);
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('sentiment', { text: 'I love this' });
    expect(result).toMatchObject({ cached: false, task: 'sentiment' });
    expect(result.result).toMatchObject({ cached: false, label: 'POSITIVE', score: 0.91 });
    expect(loader.load).toHaveBeenCalledWith('sentiment');
    expect(db.auditSets.some((set) => set.status === 'completed')).toBe(true);
  });

  it('marks the audit row failed and answers 502 when the pipeline throws', async () => {
    const db = dbStub();
    const loader = {
      load: vi.fn(async () => async () => {
        throw new Error('model exploded');
      }),
      modelFor: () => 'test/model',
    } as unknown as PipelineLoader;
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(service.run('sentiment', { text: 'hi' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(db.auditSets.some((set) => set.status === 'failed')).toBe(true);
  });

  it('maps a model timeout onto 504', async () => {
    const db = dbStub();
    const loader = {
      load: vi.fn(async () => async () => {
        throw new Error('operation timed out');
      }),
      modelFor: () => 'test/model',
    } as unknown as PipelineLoader;
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(service.run('sentiment', { text: 'hi' })).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );
  });

  it('peekCache returns the cached result with cached:true, or null on a miss', async () => {
    const hit = dbStub({ cacheRows: [{ result: { label: 'NEGATIVE', score: 0.8 } }] });
    const serviceHit = new AiService(
      hit,
      {} as unknown as TranslateService,
      pipelineLoader([]),
      configStub(),
    );
    await expect(serviceHit.peekCache('sentiment', { text: 'x' })).resolves.toMatchObject({
      cached: true,
      label: 'NEGATIVE',
    });

    const miss = dbStub();
    const serviceMiss = new AiService(
      miss,
      {} as unknown as TranslateService,
      pipelineLoader([]),
      configStub(),
    );
    await expect(serviceMiss.peekCache('sentiment', { text: 'x' })).resolves.toBeNull();
  });

  it('normalizes zero-shot output preserving label order', async () => {
    const db = dbStub();
    const loader = pipelineLoader({
      labels: ['billing', 'mobile'],
      scores: [0.12, 0.88],
      sequence: 'my phone broke',
    });
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('zero-shot-classification', {
      candidateLabels: ['billing', 'mobile'],
      text: 'my phone broke',
    });
    expect(result.result).toMatchObject({
      cached: false,
      labels: ['billing', 'mobile'],
      scores: [0.12, 0.88],
      sequence: 'my phone broke',
    });
  });

  it('normalizes feature-extraction output from a Tensor-like object', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ tolist: () => [[0.1, 0.2, 0.3]] });
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('feature-extraction', { text: 'embed me' });
    expect(result.result).toMatchObject({ dimensions: 3, embedding: [0.1, 0.2, 0.3] });
  });

  it('builds a scores vector mapping missing scores to 0 and tolerates a missing labels array', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ scores: [0.5, null, 1], sequence: 'seq' }); // labels missing
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('zero-shot-classification', {
      candidateLabels: ['a', 'b', 'c'],
      text: 'seq',
    });
    expect(result.result).toMatchObject({ labels: [], scores: [0.5, 0, 1] });
  });

  it('answers 502 when the zero-shot scores are unparseable', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ labels: ['a'], scores: [Number.NaN], sequence: 'seq' });
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(
      service.run('zero-shot-classification', { candidateLabels: ['a', 'b'], text: 'seq' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('enriches entities with a raw entity label when entity_group is absent', async () => {
    const db = dbStub();
    const loader = pipelineLoader([{ entity: 'B-PER', score: 0.5, word: 'x' }]);
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('token-classification', { text: 'x' });
    expect(result.result).toMatchObject({
      entities: [{ end: 0, entity_group: 'B-PER', score: 0.5, start: 0, word: 'x' }],
    });
  });

  it('answers 502 when a model returns nothing usable', async () => {
    const db = dbStub();
    const loader = pipelineLoader([]); // firstItem over an empty array
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(service.run('sentiment', { text: 'hi' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('answers 502 when a model returns a non-array for a list task', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ label: 'POSITIVE' }); // not an array
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(service.run('sentiment', { text: 'hi' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('answers 502 when a single-object task returns an array', async () => {
    const db = dbStub();
    const loader = pipelineLoader([{ answer: 'x' }]); // qa must be an object
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(
      service.run('question-answering', { context: 'c', question: 'q' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('reads raw Float32Array-like data when tolist() is absent', async () => {
    const db = dbStub();
    const data = new Float32Array([0.25, 0.75]);
    const loader = pipelineLoader({ data });
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('feature-extraction', { text: 'embed' });
    expect(result.result).toMatchObject({ dimensions: 2 });
  });

  it('reads flat-number vectors from tolist()', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ tolist: () => [0.5, 0.25] }); // 1-D tolist (no batch dim)
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('feature-extraction', { text: 'embed' });
    expect(result.result).toMatchObject({ dimensions: 2, embedding: [0.5, 0.25] });
  });

  it('throws when the audit insert returns no row', async () => {
    const db = dbStub({ auditReturning: [] });
    const loader = pipelineLoader([{ label: 'POSITIVE', score: 1 }]);
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    await expect(service.run('sentiment', { text: 'hi' })).rejects.toThrow(
      'ai_messages insert returned no row',
    );
  });

  it('swallows an Error-instance reaper failure by naming the class', async () => {
    const reaperDb = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              throw new Error('permission denied');
            },
          }),
        }),
      }),
    } as unknown as Database;
    const service = new AiService(
      reaperDb,
      {} as unknown as TranslateService,
      pipelineLoader([]),
      configStub(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('swallows the audit-marks-failed secondary failure and answers 502 for both secondary flavors', async () => {
    const mkDb = (secondary: unknown) =>
      ({
        ...dbStub({ auditReturning: [{ id: 'msg-1' }] }),
        update: () => ({
          set: () => ({
            where: () => Promise.reject(secondary),
          }),
        }),
      }) as unknown as Database;

    const failingLoader = {
      load: vi.fn(async () => async () => {
        throw new Error('model exploded');
      }),
      modelFor: () => 'test/model',
    } as unknown as PipelineLoader;

    for (const secondary of [new Error('boom'), 'a string, not an error'] as const) {
      const service = new AiService(
        mkDb(secondary),
        {} as unknown as TranslateService,
        failingLoader,
        configStub(),
      );
      await expect(service.run('sentiment', { text: 'hi' })).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    }
  });

  it('normalizes tasks with completely absent optional fields to empty defaults', async () => {
    const cases: Array<[string, unknown, Record<string, unknown>]> = [
      ['sentiment', [{}], { cached: false, label: '', score: 0 }],
      ['summarize', [{}], { cached: false, text: '' }],
      ['question-answering', {}, { answer: '', cached: false, end: 0, score: 0, start: 0 }],
      [
        'token-classification',
        [{}],
        { cached: false, entities: [{ end: 0, entity_group: '', score: 0, start: 0, word: '' }] },
      ],
      ['zero-shot-classification', {}, { cached: false, labels: [], scores: [], sequence: '' }],
    ];
    for (const [task, raw, expected] of cases) {
      const db = dbStub();
      const loader = pipelineLoader(raw);
      const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());
      const payload = payloadForTask(task);
      const result = await service.run(task, payload);
      expect(result.result, task).toMatchObject(expected);
    }
  });

  it('answers 502 when a single-object task receives a primitive', async () => {
    const db = dbStub();
    const loader = pipelineLoader('not an object');
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());
    await expect(
      service.run('question-answering', { context: 'c', question: 'q' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('answers 502 when the tensor output has neither tolist() nor data', async () => {
    const db = dbStub();
    const loader = pipelineLoader({}); // no tolist, no data
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());
    await expect(service.run('feature-extraction', { text: 'embed' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('answers 502 when tolist() does not return an array', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ tolist: () => 42 });
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());
    await expect(service.run('feature-extraction', { text: 'embed' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('fails fast at boot on an invalid configured model id', async () => {
    const service = new AiService(
      dbStub(),
      {} as unknown as TranslateService,
      pipelineLoader([], 'not a valid model id'),
      configStub(),
    );
    await expect(service.onModuleInit()).rejects.toThrow(/AI_SENTIMENT_MODEL/);
  });

  it('accepts absolute local paths and org/name ids in configured models', async () => {
    const reaperDb = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => [],
          }),
        }),
      }),
    } as unknown as Database;

    for (const good of [
      'org/model-name',
      'onnx-community/all-MiniLM-L6-v2-ONNX',
      '/opt/models/local',
      './relative/model',
      '../shared/model',
    ]) {
      const service = new AiService(
        reaperDb,
        {} as unknown as TranslateService,
        pipelineLoader([], good),
        configStub(),
      );
      await expect(service.onModuleInit(), good).resolves.toBeUndefined();
    }
  });

  it('reaps stale processing rows on boot and swallows a non-Error reaper failure', async () => {
    const updated: Array<Record<string, unknown>> = [];
    const reaperDb = {
      update: () => ({
        set: (value: Record<string, unknown>) => {
          updated.push(value);
          return {
            where: () => ({
              returning: async () => [{ id: 'stale-1' }],
            }),
          };
        },
      }),
    } as unknown as Database;
    const service = new AiService(
      reaperDb,
      {} as unknown as TranslateService,
      pipelineLoader([]),
      configStub(),
    );
    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(updated).toHaveLength(1);

    const brokenDb = {
      update: () => ({
        set: () => ({
          where: () => ({
            returning: async () => {
              throw 'not an error';
            },
          }),
        }),
      }),
    } as unknown as Database;
    const broken = new AiService(
      brokenDb,
      {} as unknown as TranslateService,
      pipelineLoader([]),
      configStub(),
    );
    await expect(broken.onModuleInit()).resolves.toBeUndefined();
  });

  it('aligns the response and audit row with the cache winner when the insert loses a race', async () => {
    const db = dbStub({
      txInsertReturning: [],
      txWinnerRow: { result: { label: 'WINNER', score: 0.5 } },
    });
    const loader = pipelineLoader([{ label: 'POSITIVE', score: 0.9 }]);
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('sentiment', { text: 'hi' });
    expect(result).toMatchObject({ cached: false });
    expect(result.result).toMatchObject({ cached: false, label: 'WINNER', score: 0.5 });
    expect(
      db.auditSets.some(
        (set) => set.status === 'completed' && String(set.response).includes('WINNER'),
      ),
    ).toBe(true);
  });

  it('delegates translate to the catalogue-cached translate service', async () => {
    const translateResponse = { cached: true, text: 'bonjour' };
    const translateService = {
      translate: vi.fn(async () => translateResponse),
    } as unknown as TranslateService;

    const service = new AiService(
      dbStub(),
      translateService,
      pipelineLoader([]),
      configStub({ OLLAMA_TEXT_MODEL: 'bonsai-2:2b' }),
    );

    const result = await service.run('translate', { targetLanguage: 'fr', text: 'hello' });
    expect(result).toEqual({
      cached: true,
      model: 'bonsai-2:2b',
      result: { cached: true, text: 'bonjour' },
      task: 'translate',
    });
    expect(translateService.translate).toHaveBeenCalledWith({
      targetLanguage: 'fr',
      text: 'hello',
    });
  });

  it('answers QA even when the model omits character offsets', async () => {
    const db = dbStub();
    const loader = pipelineLoader({ answer: 'a nice puppet', score: 0.57 });
    const service = new AiService(db, {} as unknown as TranslateService, loader, configStub());

    const result = await service.run('question-answering', {
      context: 'Jim Henson was a nice puppet.',
      question: 'Who was Jim Henson?',
    });
    expect(result.result).toMatchObject({ answer: 'a nice puppet', end: 0, start: 0 });
  });
});
