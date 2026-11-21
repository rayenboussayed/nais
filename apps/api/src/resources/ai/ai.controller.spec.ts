import { describe, expect, it, vi } from 'vitest';

import type { AiService } from './ai.service.js';

import { AiController } from './ai.controller.js';

/**
 * Builds the controller with a stubbed AI service.
 * @param service - the service stub to inject (defaults to a fresh one)
 * @returns the controller under test
 */
function controller(service = serviceStub()) {
  return new AiController(service as unknown as AiService);
}

/**
 * Builds the cache-miss envelope shape the service returns.
 * @param task - the task the envelope belongs to
 * @param result - the task result payload
 * @returns the envelope
 */
function envelopeFor(task: string, result: Record<string, unknown>) {
  return { cached: false, model: 'test/model', result, task };
}

/**
 * Service stub: canned listTasks + run/peekCache behaviour.
 * @returns the AiService stub
 */
function serviceStub() {
  return {
    listTasks: vi.fn(() => [
      {
        description: 'test',
        label: 'Sentiment',
        model: 'Xenova/test-model',
        provider: 'transformers',
        task: 'sentiment',
      },
    ]),
    run: vi.fn(),
  };
}

describe('AiController', () => {
  it('lists tasks from the service registry', () => {
    const response = controller().tasks();
    expect(response.items).toHaveLength(1);
    expect(response.items[0]?.task).toBe('sentiment');
  });

  it('translate maps the envelope onto the shared TranslateResponse shape', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () => ({
      cached: true,
      model: 'bonsai-2:2b',
      result: { cached: true, text: 'bonjour' },
      task: 'translate' as const,
    }));
    const response = await controller(service).translate({ targetLanguage: 'fr', text: 'hello' });
    expect(response).toEqual({ cached: true, text: 'bonjour' });
    expect(service.run).toHaveBeenCalledWith('translate', { targetLanguage: 'fr', text: 'hello' });
  });

  it('translate maps a missing model text to an empty string', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () => ({
      cached: false,
      model: 'bonsai-2:2b',
      result: { cached: false },
      task: 'translate' as const,
    }));
    const response = await controller(service).translate({ targetLanguage: 'fr', text: 'hello' });
    expect(response).toEqual({ cached: false, text: '' });
    expect(service.run).toHaveBeenCalledWith('translate', { targetLanguage: 'fr', text: 'hello' });
  });

  it('sentiment delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('sentiment', { cached: false, label: 'POSITIVE', score: 0.9 }),
    );
    const response = await controller(service).sentiment({ text: 'I love this' });
    expect(response).toMatchObject({ cached: false, label: 'POSITIVE' });
    expect(service.run).toHaveBeenCalledWith('sentiment', { text: 'I love this' });
  });

  it('summarize delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () => envelopeFor('summarize', { cached: false, text: 'short' }));
    const response = await controller(service).summarize({ text: 'a long document' });
    expect(response.text).toBe('short');
    expect(service.run).toHaveBeenCalledWith('summarize', { text: 'a long document' });
  });

  it('questionAnswering delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('question-answering', {
        answer: 'a',
        cached: false,
        end: 1,
        score: 0.5,
        start: 0,
      }),
    );
    const response = await controller(service).questionAnswering({
      context: 'context',
      question: 'who?',
    });
    expect(response.answer).toBe('a');
    expect(service.run).toHaveBeenCalledWith('question-answering', {
      context: 'context',
      question: 'who?',
    });
  });

  it('tokenClassification delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('token-classification', { cached: false, entities: [] }),
    );
    const response = await controller(service).tokenClassification({
      text: 'Sarah lives in London',
    });
    expect(response.entities).toEqual([]);
  });

  it('zeroShot delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('zero-shot-classification', {
        cached: false,
        labels: ['a', 'b'],
        scores: [0.6, 0.4],
        sequence: 's',
      }),
    );
    const response = await controller(service).zeroShot({ candidateLabels: ['a', 'b'], text: 's' });
    expect(response.scores).toEqual([0.6, 0.4]);
  });

  it('featureExtraction delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('feature-extraction', { cached: false, dimensions: 2, embedding: [0.1, 0.2] }),
    );
    const response = await controller(service).featureExtraction({ text: 'embed' });
    expect(response.dimensions).toBe(2);
  });
});
