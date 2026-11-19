import type { JobWithMetadata } from 'pg-boss';
import { describe, expect, it, vi } from 'vitest';

import type { AiTaskJob } from '@trainslator/shared';

import type { AiService } from '../ai/ai.service';
import type { TranslateGateway } from '../ws/translate.gateway';

import { AiTaskWorker } from './ai-task.worker';

function makeJob(data: AiTaskJob): JobWithMetadata<AiTaskJob> {
  return { id: 'job-1', name: 'ai-task', data } as never;
}

const translateEnvelope = {
  task: 'translate' as const,
  result: { text: 'bonjour', cached: false },
  cached: false,
  model: 'bonsai-2:2b',
};

const sentimentEnvelope = {
  task: 'sentiment' as const,
  result: { label: 'POSITIVE', score: 0.99, cached: false },
  cached: false,
  model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
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
        task: 'translate',
        input: { text: 'hello', targetLanguage: 'fr' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
      }),
    ]);

    expect(run).toHaveBeenCalledWith('translate', { text: 'hello', targetLanguage: 'fr' });
    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'translation',
      expect.objectContaining({ text: 'bonjour', cached: false }),
    );
  });

  it('falls back to an empty text when the translate result carries no text string', async () => {
    const emitTo = vi.fn();
    const run = vi.fn(async () => ({
      task: 'translate' as const,
      result: { text: 42 as unknown as string, cached: false },
      cached: false,
      model: 'test/model',
    }));
    const worker = new AiTaskWorker(
      { run } as unknown as AiService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onAiTask([
      makeJob({
        task: 'translate',
        input: { text: 'hello', targetLanguage: 'fr' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
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
        task: 'sentiment',
        input: { text: 'I love this' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
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
          task: 'translate',
          input: { text: 'hello', targetLanguage: 'fr' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
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
          task: 'summarize',
          input: { text: 'long document' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
        }),
      ]),
    ).rejects.toThrow('boom');

    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'ai-error',
      expect.objectContaining({ task: 'summarize', message: 'AI task failed' }),
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
          task: 'sentiment',
          input: { text: 'hello' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
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
        task: 'translate',
        input: { text: 'hello', targetLanguage: 'fr' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
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
          task: 'sentiment',
          input: { text: 'hello' },
          requestId: '123e4567-e89b-42d3-a456-426655440000',
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
