import type { AiTask, AiTaskDescriptor } from '@trainslator/shared';

import { AI_TASKS, aiTaskSchema } from '@trainslator/shared';

/**
 * Static registry of the tasks the service runs. The `translate` task is a
 * thin wrapper over the catalogue-cached translate pipeline; the others run
 * dedicated ONNX pipelines through `@huggingface/transformers`.
 *
 * Models are overridable per environment: `AI_<TASK>_MODEL` (dashes → `_`,
 * upper cased) — see {@link modelEnvKey}.
 */

export interface AiTaskEntry {
  defaultModel: string;
  /** One-line description. */
  description: string;
  /** Short label for UIs and Swagger. */
  label: string;
  provider: 'ollama' | 'transformers';
}

export const AI_TASK_REGISTRY: Record<AiTask, AiTaskEntry> = {
  'feature-extraction': {
    defaultModel: 'onnx-community/all-MiniLM-L6-v2-ONNX',
    description: 'Dense sentence embedding (mean-pooled, normalized) for semantic use.',
    label: 'Embeddings',
    provider: 'transformers',
  },
  'question-answering': {
    defaultModel: 'Xenova/distilbert-base-uncased-distilled-squad',
    description: 'Extractive QA: answer a question using only spans from a given context.',
    label: 'Question answering',
    provider: 'transformers',
  },
  sentiment: {
    defaultModel: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    description: 'Binary SST-2 sentiment: POSITIVE/NEGATIVE with a confidence score.',
    label: 'Sentiment',
    provider: 'transformers',
  },
  summarize: {
    defaultModel: 'Xenova/distilbart-cnn-6-6',
    description: 'Produce a short summary of longer text (CNN/DailyMail-style distilbart).',
    label: 'Summarize',
    provider: 'transformers',
  },
  'token-classification': {
    defaultModel: 'Xenova/bert-base-NER',
    description: 'Token classification over arbitrary text; CoNLL-2003 entity groups.',
    label: 'Named entities (NER)',
    provider: 'transformers',
  },
  translate: {
    defaultModel: 'bonsai-2:2b',
    description:
      'Translate text into a target language (ISO 639-1), served from the catalogue cache when possible.',
    label: 'Translate',
    provider: 'ollama',
  },
  'zero-shot-classification': {
    defaultModel: 'Xenova/nli-deberta-v3-xsmall',
    description: 'Classify into arbitrary candidate labels without retraining (NLI).',
    label: 'Zero-shot classification',
    provider: 'transformers',
  },
};

/**
 * Default fallback model per task; env override wins when set.
 * @param task - the task whose default model to resolve
 * @returns the registry default model id
 */
export function defaultModelFor(task: AiTask): string {
  // eslint-disable-next-line security/detect-object-injection -- task: AiTask, registry keyed by AiTask
  return AI_TASK_REGISTRY[task].defaultModel;
}

/**
 * Public descriptor for `GET /api/ai/tasks`.
 * @param resolveModel - resolves the effective model for one task
 * @returns the descriptors, in registry order
 */
export function listTaskDescriptors(resolveModel: (task: AiTask) => string): AiTaskDescriptor[] {
  return AI_TASKS.map((task) => {
    // eslint-disable-next-line security/detect-object-injection -- task from AI_TASKS (AiTask[])
    const entry = AI_TASK_REGISTRY[task];
    return {
      description: entry.description,
      label: entry.label,
      model: resolveModel(task),
      provider: entry.provider,
      task: aiTaskSchema.parse(task),
    };
  });
}

/**
 * `sentiment` → `AI_SENTIMENT_MODEL`, `zero-shot-classification` → `AI_ZERO_SHOT_CLASSIFICATION_MODEL`.
 * @param task - the task whose env key to derive
 * @returns the env key name
 */
export function modelEnvKey(task: AiTask): string {
  return `AI_${task.replace(/-/g, '_').toUpperCase()}_MODEL`;
}
