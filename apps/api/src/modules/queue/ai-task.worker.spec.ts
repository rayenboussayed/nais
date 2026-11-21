import type { JobWithMetadata } from 'pg-boss';

import { describe, expect, it, vi } from 'vitest';

import type { AiService } from '../../resources/ai/ai.service.js';
import type { TranslateGateway } from '../../resources/translate/translate.gateway.js';
import type { AiTaskJob } from '../../schemas/queue.js';

import { aiTaskJobSchema } from '../../schemas/queue.js';
import { AiTaskWorker } from './ai-task.worker.js';

/**
 * Builds a pg-boss job carrying the given AI task payload.
 * @param data - the job payload
 * @returns the job double
 */
function makeJob(data: AiTaskJob): JobWithMetadata<AiTaskJob> {
  return { data, id: 'job-1', name: 'ai-task' } as never;
}

const translateEnvelope = {
  cached: false,
  model: 'bonsai-2:2b',
  result: { cached: false, text: 'bonjour' },
  task: 'translate' as const,
};

const sentimentEnvelope = {
  cached: false,
  model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  result: { cached: false, label: 'POSITIVE', score: 0.99 },
  task: 'sentiment' as const,
};

describe('AiTaskWorker.onAiTask', () => {
  it('emits a translation event for the translate task', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => translateEnvelope);
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onAiTask([
      makeJob({
        input: { targetLanguage: 'fr', text: 'hello' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
        task: 'translate',
      }),
    ]);

    expect(run).toHaveBeenCalledWith('translate', { targetLanguage: 'fr', text: 'hello' });
    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'translation',
      expect.objectContaining({ cached: false, text: 'bonjour' }),
    );
  });

  it('falls back to an empty text when the translate result carries no text string', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => ({
      cached: false,
      model: 'test/model',
      result: { cached: false, text: 42 as unknown as string },
      task: 'translate' as const,
    }));
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onAiTask([
      makeJob({
        input: { targetLanguage: 'fr', text: 'hello' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
        task: 'translate',
      }),
    ]);

    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'translation',
      expect.objectContaining({ text: '' }),
    );
  });

  it('emits an ai-result event for a dedicated task', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => sentimentEnvelope);
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onAiTask([
      makeJob({
        input: { text: 'I love this' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
        task: 'sentiment',
      }),
    ]);

    expect(run).toHaveBeenCalledWith('sentiment', { text: 'I love this' });
    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'ai-result',
      expect.objectContaining({ task: 'sentiment' }),
    );
    expect(emitTo).not.toHaveBeenCalledWith('socket-1', 'translation', expect.anything());
  });

  it('emits translation-error and rethrows on translate failure so pg-boss marks the job failed', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => Promise.reject(new Error('model exploded')));
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onAiTask([
        makeJob({
          input: { targetLanguage: 'fr', text: 'hello' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
          task: 'translate',
        }),
      ]),
    ).rejects.toThrow('model exploded');

    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'translation-error',
      expect.objectContaining({ message: 'Translation failed' }),
    );
  });

  it('emits ai-error and rethrows on dedicated-task failure', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => Promise.reject(new Error('boom')));
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onAiTask([
        makeJob({
          input: { text: 'long document' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
          task: 'summarize',
        }),
      ]),
    ).rejects.toThrow('boom');

    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'ai-error',
      expect.objectContaining({ message: 'AI task failed', task: 'summarize' }),
    );
  });

  it('serializes failures thrown as non-Errors', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => Promise.reject('string failure'));
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onAiTask([
        makeJob({
          input: { text: 'hello' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
          task: 'sentiment',
        }),
      ]),
    ).rejects.toBe('string failure');
  });

  it('does not emit when the requester has gone away, and a job without socketId survives', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => translateEnvelope);
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onAiTask([
      makeJob({
        input: { targetLanguage: 'fr', text: 'hello' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'translate',
      }),
    ]);
    expect(emitTo).not.toHaveBeenCalled();
  });

  it('throws on failure even without a socketId so the job is marked failed', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => Promise.reject(new Error('boom')));
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onAiTask([
        makeJob({
          input: { text: 'hello' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          task: 'sentiment',
        }),
      ]),
    ).rejects.toThrow('boom');
    expect(emitTo).not.toHaveBeenCalled();
  });

  it('is a no-op for an empty batch', async () => {
    const worker = new AiTaskWorker(
      { run: vi.fn() } as unknown as AiService,
      { emitTo: vi.fn() } as unknown as TranslateGateway,
    );
    await expect(worker.onAiTask([])).resolves.toBeUndefined();
  });
});

describe('AiTaskWorker invalid payload', () => {
  it('rejects a malformed job instead of calling the AI service', async () => {
    const run = vi.fn();
    const emitTo = vi.fn();
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );
    const errorSpy = vi.spyOn(worker, 'error').mockImplementation(() => worker);

    await expect(worker.onAiTask([makeJob({ task: 'unknown-task' } as never)])).rejects.toThrow(
      'ai task job payload rejected',
    );

    expect(run).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('payload rejected'));
  });
});

describe('AiTaskWorker invalid payload fallback', () => {
  it('uses the generic message when a validation failure carries no issues', async () => {
    const worker = new AiTaskWorker(
      { run: vi.fn() } as unknown as AiService,
      { emitTo: vi.fn() } as unknown as TranslateGateway,
    );
    const errorSpy = vi.spyOn(worker, 'error').mockImplementation(() => worker);
    vi.spyOn(aiTaskJobSchema, 'safeParse').mockReturnValue({
      error: { issues: [] },
      success: false,
    } as never);

    await expect(worker.onAiTask([makeJob({ task: 'translate' } as never)])).rejects.toThrow(
      'ai task job payload rejected',
    );

    expect(errorSpy).toHaveBeenCalledWith('ai task job payload rejected: invalid payload');
  });
});
