import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const transformersMock = vi.hoisted(() => ({
  pipeline: vi.fn(),
}));

const webgpuGlobalsMock = vi.hoisted(() => ({
  ensureWebgpuGlobals: vi.fn(),
}));

vi.mock('@huggingface/transformers', () => ({
  pipeline: transformersMock.pipeline,
}));

vi.mock('./webgpu-globals.js', () => ({
  ensureWebgpuGlobals: webgpuGlobalsMock.ensureWebgpuGlobals,
}));

import { importTimeEnv, PipelineLoader, resolveModelId } from './pipeline-loader.js';
import { AI_TASK_REGISTRY, defaultModelFor, listTaskDescriptors, modelEnvKey } from './tasks.js';

const taskList = Object.keys(AI_TASK_REGISTRY) as Array<keyof typeof AI_TASK_REGISTRY>;

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Extracts the `device` from a mocked pipeline call's options argument.
 * @param call - the mocked pipeline call arguments ([task, model, options])
 * @returns the device id passed to the pipeline
 */
const deviceOf = (call: unknown[]) => (call[2] as Record<string, unknown>).device;

/**
 * Stubs ConfigService with the keys the unit under test reads.
 * @param overrides - env keys to override in the stubbed parsed config
 * @returns the ConfigService double
 */
function configStub(overrides: Record<string, string | undefined> = {}) {
  const base: Record<string, string | undefined> = {
    AI_DEVICE: undefined,
    AI_FEATURE_EXTRACTION_MODEL: undefined,
    AI_QUESTION_ANSWERING_MODEL: undefined,
    AI_SENTIMENT_MODEL: undefined,
    AI_SUMMARIZE_MODEL: undefined,
    AI_TOKEN_CLASSIFICATION_MODEL: undefined,
    AI_ZERO_SHOT_CLASSIFICATION_MODEL: undefined,
    HF_CACHE_DIR: undefined,
    ...overrides,
  };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test stub: config keys are compile-time constants of the stub
    get: (key: string) => base[key],
  } as never;
}

describe('tasks registry', () => {
  it('maps every task to a default model and env key', () => {
    for (const task of taskList) {
      // eslint-disable-next-line security/detect-object-injection -- task iterates AI_TASKS (AiTask[])
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
    webgpuGlobalsMock.ensureWebgpuGlobals.mockReset().mockResolvedValue(undefined);
  });

  it('memoizes the pipeline per effective model id', async () => {
    transformersMock.pipeline.mockResolvedValue(async () => [{ label: 'POSITIVE', score: 1 }]);
    const loader = new PipelineLoader(configStub());
    const first = await loader.load('sentiment');
    const second = await loader.load('sentiment');
    expect(first).toBe(second);
    expect(transformersMock.pipeline).toHaveBeenCalledTimes(1);
    expect(deviceOf(transformersMock.pipeline.mock.calls[0] as unknown[])).toBe('webgpu');
  });

  it('passes HF_CACHE_DIR through to the pipeline options', async () => {
    transformersMock.pipeline.mockResolvedValue(async () => 'pipeline');
    const loader = new PipelineLoader(configStub({ HF_CACHE_DIR: 'hf-cache-fixture' }));
    await loader.load('sentiment');
    expect(transformersMock.pipeline.mock.calls[0]?.[2]).toMatchObject({
      cache_dir: 'hf-cache-fixture',
      device: 'webgpu',
    });
  });

  it('falls back to cpu when the webgpu load fails', async () => {
    transformersMock.pipeline
      .mockRejectedValueOnce(new Error('webgpu boom'))
      .mockResolvedValueOnce(async () => 'cpu-pipeline');
    const loader = new PipelineLoader(configStub());
    await expect(loader.load('sentiment')).resolves.toBeDefined();
    expect(transformersMock.pipeline.mock.calls.map(deviceOf)).toEqual(['webgpu', 'cpu']);
  });

  it('skips webgpu entirely when the webgpu globals cannot be installed', async () => {
    webgpuGlobalsMock.ensureWebgpuGlobals.mockRejectedValueOnce(new Error('no dawn binding'));
    transformersMock.pipeline.mockResolvedValue(async () => 'cpu-pipeline');
    const loader = new PipelineLoader(configStub());
    await expect(loader.load('sentiment')).resolves.toBeDefined();
    expect(webgpuGlobalsMock.ensureWebgpuGlobals).toHaveBeenCalledTimes(1);
    expect(transformersMock.pipeline.mock.calls.map(deviceOf)).toEqual(['cpu']);
  });

  it('honors an AI_DEVICE pin and disables the fallback for it', async () => {
    transformersMock.pipeline.mockRejectedValue(new Error('boom'));
    const loader = new PipelineLoader(configStub({ AI_DEVICE: 'cpu' }));
    await expect(loader.load('sentiment')).rejects.toThrow('boom');
    expect(transformersMock.pipeline.mock.calls.map(deviceOf)).toEqual(['cpu']);

    transformersMock.pipeline.mockReset().mockResolvedValue(async () => 'webgpu-pipeline');
    const gpuLoader = new PipelineLoader(configStub({ AI_DEVICE: 'webgpu' }));
    await gpuLoader.load('sentiment');
    expect(transformersMock.pipeline.mock.calls.map(deviceOf)).toEqual(['webgpu']);
  });

  it('clears the pending cache when every device fails, then applies a cooldown before re-attempting', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-19T00:00:00Z'));
    try {
      transformersMock.pipeline.mockRejectedValue(new Error('download failed'));

      const loader = new PipelineLoader(configStub());
      await expect(loader.load('sentiment')).rejects.toThrow('download failed');
      expect(transformersMock.pipeline).toHaveBeenCalledTimes(2);
      expect(transformersMock.pipeline.mock.calls.map(deviceOf)).toEqual(['webgpu', 'cpu']);

      // Within the cooldown window the loader refuses to retry (no re-attempt on any device).
      await expect(loader.load('sentiment')).rejects.toThrow(/recently failed/);
      expect(transformersMock.pipeline).toHaveBeenCalledTimes(2);

      // After the cooldown elapses, the next call attempts the load again.
      vi.setSystemTime(new Date('2026-11-19T00:00:31Z'));
      await expect(loader.load('sentiment')).rejects.toThrow('download failed');
      expect(transformersMock.pipeline).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('propagates a non-Error pipeline failure after exhausting the device chain', async () => {
    const rawFailure = { reason: 'bad model' };
    transformersMock.pipeline.mockRejectedValue(rawFailure);
    const loader = new PipelineLoader(configStub());
    await expect(loader.load('sentiment')).rejects.toBe(rawFailure);
    expect(transformersMock.pipeline.mock.calls.map(deviceOf)).toEqual(['webgpu', 'cpu']);
  });

  it('honors the env override for the effective model id and keeps the registry default for translate', () => {
    const loader = new PipelineLoader(configStub({ AI_SENTIMENT_MODEL: 'acme/fast-sentiment' }));
    expect(loader.modelFor('sentiment')).toBe('acme/fast-sentiment');
    expect(loader.modelFor('translate')).toBe(defaultModelFor('translate'));
  });
});

describe('importTimeEnv', () => {
  it('returns the empty-string default when the variable is unset', () => {
    expect(importTimeEnv('SOME_UNSET_KEY', '', {})).toBe('');
  });

  it('preserves an explicit default for unset variables (NODE_ENV → development)', () => {
    expect(importTimeEnv('NODE_ENV', 'development', {})).toBe('development');
  });

  it('uses `??` semantics: an empty string is a value, not the default', () => {
    expect(importTimeEnv('CORS_ORIGINS', 'fallback', { CORS_ORIGINS: '' })).toBe('');
    expect(importTimeEnv('CORS_ORIGINS', 'fallback', { CORS_ORIGINS: 'https://a.example' })).toBe(
      'https://a.example',
    );
  });

  it('reads from process.env when no source map is supplied', () => {
    vi.stubEnv('IMPORT_TIME_ENV_PROBE', 'from-process-env');
    expect(importTimeEnv('IMPORT_TIME_ENV_PROBE')).toBe('from-process-env');
  });

  it('falls back to the registry default when the model override is unset or blank', () => {
    expect(resolveModelId('sentiment', { AI_SENTIMENT_MODEL: '' })).toBe(
      defaultModelFor('sentiment'),
    );
    vi.stubEnv('AI_SENTIMENT_MODEL', '');
    expect(resolveModelId('sentiment')).toBe(defaultModelFor('sentiment'));
  });
});
