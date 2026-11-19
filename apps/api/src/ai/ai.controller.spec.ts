import { describe, expect, it, vi } from 'vitest';

import { AiController } from './ai.controller.js';
import type { AiService } from './ai.service.js';

function envelopeFor(task: string, result: Record<string, unknown>) {
  return { task, result, cached: false, model: 'test/model' };
}

function serviceStub() {
  return {
    run: vi.fn(),
    listTasks: vi.fn(() => [
      {
        task: 'sentiment',
        provider: 'transformers',
        model: 'Xenova/test-model',
        label: 'Sentiment',
        description: 'test',
      },
    ]),
  };
}

function controller(service = serviceStub()) {
  return new AiController(service as unknown as AiService);
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
      task: 'translate' as const,
      result: { text: 'bonjour', cached: true },
      cached: true,
      model: 'bonsai-2:2b',
    }));
    const response = await controller(service).translate({ text: 'hello', targetLanguage: 'fr' });
    expect(response).toEqual({ text: 'bonjour', cached: true });
    expect(service.run).toHaveBeenCalledWith('translate', { text: 'hello', targetLanguage: 'fr' });
  });

  it('sentiment delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('sentiment', { label: 'POSITIVE', score: 0.9, cached: false }),
    );
    const response = await controller(service).sentiment({ text: 'I love this' });
    expect(response).toMatchObject({ label: 'POSITIVE', cached: false });
    expect(service.run).toHaveBeenCalledWith('sentiment', { text: 'I love this' });
  });

  it('summarize delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () => envelopeFor('summarize', { text: 'short', cached: false }));
    const response = await controller(service).summarize({ text: 'a long document' });
    expect(response.text).toBe('short');
    expect(service.run).toHaveBeenCalledWith('summarize', { text: 'a long document' });
  });

  it('questionAnswering delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('question-answering', {
        answer: 'a',
        score: 0.5,
        start: 0,
        end: 1,
        cached: false,
      }),
    );
    const response = await controller(service).questionAnswering({
      question: 'who?',
      context: 'context',
    });
    expect(response.answer).toBe('a');
    expect(service.run).toHaveBeenCalledWith('question-answering', {
      question: 'who?',
      context: 'context',
    });
  });

  it('tokenClassification delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('token-classification', { entities: [], cached: false }),
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
        sequence: 's',
        labels: ['a', 'b'],
        scores: [0.6, 0.4],
        cached: false,
      }),
    );
    const response = await controller(service).zeroShot({ text: 's', candidateLabels: ['a', 'b'] });
    expect(response.scores).toEqual([0.6, 0.4]);
  });

  it('featureExtraction delegates to the service', async () => {
    const service = serviceStub();
    service.run = vi.fn(async () =>
      envelopeFor('feature-extraction', { embedding: [0.1, 0.2], dimensions: 2, cached: false }),
    );
    const response = await controller(service).featureExtraction({ text: 'embed' });
    expect(response.dimensions).toBe(2);
  });
});
