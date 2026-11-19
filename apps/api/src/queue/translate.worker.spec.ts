import { describe, expect, it, vi } from 'vitest';

import type { WsTranslateJob } from '@trainslator/shared';

import type { TranslateService } from '../translate/translate.service';
import type { TranslateGateway } from '../ws/translate.gateway';

import { TranslateWorker } from './translate.worker';

function makeJob(data: WsTranslateJob) {
  return { id: 'job-1', name: 'translate', data } as never;
}

describe('TranslateWorker.onTranslate', () => {
  it('emits a translation event to the requesting socket on success', async () => {
    const emitTo = vi.fn();
    const translate = vi.fn(async () => ({ text: 'bonjour', cached: false }));
    const worker = new TranslateWorker(
      { translate } as unknown as TranslateService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onTranslate([
      makeJob({
        text: 'hello',
        targetLanguage: 'fr',
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        socketId: 'socket-1',
      }),
    ]);

    expect(translate).toHaveBeenCalledWith({ text: 'hello', targetLanguage: 'fr' });
    expect(emitTo).toHaveBeenCalledWith(
      'socket-1',
      'translation',
      expect.objectContaining({ text: 'bonjour' }),
    );
  });

  it('emits a translation-error event and rethrows so pg-boss marks the job failed', async () => {
    const emitTo = vi.fn();
    const translate = vi.fn(async () => Promise.reject(new Error('model exploded')));
    const worker = new TranslateWorker(
      { translate } as unknown as TranslateService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onTranslate([
        makeJob({
          text: 'hello',
          targetLanguage: 'fr',
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

  it('does not emit when the requester has gone away, and a job with no socketId survives', async () => {
    const emitTo = vi.fn();
    const translate = vi.fn(async () => ({ text: 'bonjour', cached: true }));
    const worker = new TranslateWorker(
      { translate } as unknown as TranslateService,
      { emitTo } as unknown as TranslateGateway,
    );

    await worker.onTranslate([
      makeJob({
        text: 'hello',
        targetLanguage: 'fr',
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      }),
    ]);
    expect(emitTo).not.toHaveBeenCalled();
  });

  it('throws on failure even without a socketId so the job is marked failed', async () => {
    const emitTo = vi.fn();
    const translate = vi.fn(async () => Promise.reject(new Error('boom')));
    const worker = new TranslateWorker(
      { translate } as unknown as TranslateService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onTranslate([
        makeJob({
          text: 'hello',
          targetLanguage: 'fr',
          requestId: '123e4567-e89b-42d3-a456-426655440000',
        }),
      ]),
    ).rejects.toThrow('boom');
    expect(emitTo).not.toHaveBeenCalled();
  });

  it('serializes failures thrown as non-Errors', async () => {
    const emitTo = vi.fn();
    const translate = vi.fn(async () => Promise.reject('string failure'));
    const worker = new TranslateWorker(
      { translate } as unknown as TranslateService,
      { emitTo } as unknown as TranslateGateway,
    );

    await expect(
      worker.onTranslate([
        makeJob({
          text: 'hello',
          targetLanguage: 'fr',
          requestId: '123e4567-e89b-42d3-a456-426655440000',
          socketId: 'socket-1',
        }),
      ]),
    ).rejects.toBe('string failure');
  });

  it('is a no-op for an empty batch', async () => {
    const worker = new TranslateWorker(
      { translate: vi.fn() } as unknown as TranslateService,
      { emitTo: vi.fn() } as unknown as TranslateGateway,
    );
    await expect(worker.onTranslate([])).resolves.toBeUndefined();
  });
});
