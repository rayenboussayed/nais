import { beforeEach, describe, expect, it, vi } from 'vitest';

const transformersMock = vi.hoisted(() => ({
  pipeline: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  pipeline: transformersMock.pipeline,
}));

import { resolveModelId, PipelineLoader } from './pipeline-loader';
import { modelEnvKey, defaultModelFor, listTaskDescriptors, AI_TASK_REGISTRY } from './tasks';

const taskList = Object.keys(AI_TASK_REGISTRY) as Array<keyof typeof AI_TASK_REGISTRY>;

function configStub(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    AI_SENTIMENT_MODEL: undefined,
    AI_SUMMARIZE_MODEL: undefined,
    AI_QUESTION_ANSWERING_MODEL: undefined,
    AI_TOKEN_CLASSIFICATION_MODEL: undefined,
    AI_ZERO_SHOT_CLASSIFICATION_MODEL: undefined,
    AI_FEATURE_EXTRACTION_MODEL: undefined,
    ...overrides,
  };
  return {
    get: (key: string) => base[key],
  } as never;
}

describe('tasks registry', () => {
  it('maps every task to a default model and env key', () => {
    for (const task of taskList) {
      expect(defaultModelFor(task)).toBe(AI_TASK_REGISTRY[task].defaultModel);
      expect(modelEnvKey(task)).toBe(`AI_${task.replace(/-/g, '_').toUpperCase()}_MODEL`);
    }
  });

  it('resolves overrides with whitespace tolerated and falls back to defaults otherwise', () => {
    expect(resolveModelId('sentiment', { AI_SENTIMENT_MODEL: '  custom/model  ' })).toBe(
      'custom/model',
    );
    expect(resolveModelId('sentiment', { AI_SENTIMENT_MODEL: '   ' })).toBe(
      'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    );
    expect(resolveModelId('summarize', {})).toBe('Xenova/distilbart-cnn-6-6');
  });

  it('lists descriptors for every task with provider and model resolved via the callback', () => {
    const descriptors = listTaskDescriptors((task) => `model/${task}`);
    expect(descriptors).toHaveLength(taskList.length);
    const byTask = new Map(descriptors.map((entry) => [entry.task, entry]));
    expect(byTask.get('translate')?.provider).toBe('ollama');
    expect(byTask.get('translate')?.model).toBe('model/translate');
    expect(byTask.get('sentiment')?.provider).toBe('transformers');
    expect(typeof byTask.get('feature-extraction')?.description).toBe('string');
  });
});

describe('PipelineLoader', () => {
  beforeEach(() => {
    transformersMock.pipeline.mockReset();
  });

  it('memoizes the pipeline per effective model id', async () => {
    transformersMock.pipeline.mockResolvedValue(async () => [{ label: 'POSITIVE', score: 1 }]);
    const loader = new PipelineLoader(configStub());
    const first = await loader.load('sentiment');
    const second = await loader.load('sentiment');
    expect(first).toBe(second);
    expect(transformersMock.pipeline).toHaveBeenCalledTimes(1);
  });

  it('clears the pending cache on failure but applies a cooldown before re-attempting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:00Z'));
    try {
      transformersMock.pipeline
        .mockRejectedValueOnce(new Error('download failed'))
        .mockResolvedValueOnce(async () => [{ label: 'NEGATIVE', score: 1 }]);

      const loader = new PipelineLoader(configStub());
      await expect(loader.load('sentiment')).rejects.toThrow('download failed');

      // Within the cooldown window the loader refuses to retry (no second download attempt).
      await expect(loader.load('sentiment')).rejects.toThrow(/recently failed/);
      expect(transformersMock.pipeline).toHaveBeenCalledTimes(1);

      // After the cooldown elapses, the next call attempts the load again.
      vi.setSystemTime(new Date('2026-11-19T00:00:31Z'));
      await expect(loader.load('sentiment')).resolves.toBeDefined();
      expect(transformersMock.pipeline).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors the env override for the effective model id and keeps the registry default for translate', () => {
    const loader = new PipelineLoader(configStub({ AI_SENTIMENT_MODEL: 'acme/fast-sentiment' }));
    expect(loader.modelFor('sentiment')).toBe('acme/fast-sentiment');
    expect(loader.modelFor('translate')).toBe(defaultModelFor('translate'));
  });
});
