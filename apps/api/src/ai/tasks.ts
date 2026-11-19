import type { AiTask, AiTaskDescriptor } from '@trainslator/shared';
import { aiTaskSchema, AI_TASKS } from '@trainslator/shared';

/**
 * Static registry of the tasks the service runs. The `translate` task is a
 * thin wrapper over the catalogue-cached translate pipeline; the others run
 * dedicated ONNX pipelines through `@huggingface/transformers`.
 *
 * Models are overridable per environment: `AI_<TASK>_MODEL` (dashes → `_`,
 * upper cased) — see {@link modelEnvKey}.
 */

export interface AiTaskEntry {
  provider: 'ollama' | 'transformers';
  defaultModel: string;
  /** Short label for UIs and Swagger. */
  label: string;
  /** One-line description. */
  description: string;
}

export const AI_TASK_REGISTRY: Record<AiTask, AiTaskEntry> = {
  translate: {
    provider: 'ollama',
    defaultModel: 'bonsai-2:2b',
    label: 'Translate',
    description:
      'Translate text into a target language (ISO 639-1), served from the catalogue cache when possible.',
  },
  sentiment: {
    provider: 'transformers',
    defaultModel: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    label: 'Sentiment',
    description: 'Binary SST-2 sentiment: POSITIVE/NEGATIVE with a confidence score.',
  },
  summarize: {
    provider: 'transformers',
    defaultModel: 'Xenova/distilbart-cnn-6-6',
    label: 'Summarize',
    description: 'Produce a short summary of longer text (CNN/DailyMail-style distilbart).',
  },
  'question-answering': {
    provider: 'transformers',
    defaultModel: 'Xenova/distilbert-base-uncased-distilled-squad',
    label: 'Question answering',
    description: 'Extractive QA: answer a question using only spans from a given context.',
  },
  'token-classification': {
    provider: 'transformers',
    defaultModel: 'Xenova/bert-base-NER',
    label: 'Named entities (NER)',
    description: 'Token classification over arbitrary text; CoNLL-2003 entity groups.',
  },
  'zero-shot-classification': {
    provider: 'transformers',
    defaultModel: 'Xenova/nli-deberta-v3-xsmall',
    label: 'Zero-shot classification',
    description: 'Classify into arbitrary candidate labels without retraining (NLI).',
  },
  'feature-extraction': {
    provider: 'transformers',
    defaultModel: 'onnx-community/all-MiniLM-L6-v2-ONNX',
    label: 'Embeddings',
    description: 'Dense sentence embedding (mean-pooled, normalized) for semantic use.',
  },
};

/** `sentiment` → `AI_SENTIMENT_MODEL`, `zero-shot-classification` → `AI_ZERO_SHOT_CLASSIFICATION_MODEL`. */
export function modelEnvKey(task: AiTask): string {
  return `AI_${task.replace(/-/g, '_').toUpperCase()}_MODEL`;
}

/** Default fallback model per task; env override wins when set. */
export function defaultModelFor(task: AiTask): string {
  return AI_TASK_REGISTRY[task].defaultModel;
}

/** Public descriptor for `GET /api/ai/tasks`. */
export function listTaskDescriptors(resolveModel: (task: AiTask) => string): AiTaskDescriptor[] {
  return AI_TASKS.map((task) => {
    const entry = AI_TASK_REGISTRY[task];
    return {
      task: aiTaskSchema.parse(task),
      provider: entry.provider,
      model: resolveModel(task),
      label: entry.label,
      description: entry.description,
    };
  });
}

