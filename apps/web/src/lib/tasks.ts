import type { AiTaskDescriptor } from '@trainslator/shared';

import { useQuery } from '@tanstack/react-query';
import { aiTaskDescriptorSchema } from '@trainslator/shared';

import { apiFetch } from './api';

/** Local fallback so the Studio renders even if the tasks endpoint is unreachable. */
const FALLBACK_TASKS: AiTaskDescriptor[] = [
  {
    description: 'Translate text into a target language.',
    label: 'Translate',
    model: 'bonsai-2:2b',
    provider: 'ollama',
    task: 'translate',
  },
  {
    description: 'Binary SST-2 sentiment with a confidence score.',
    label: 'Sentiment',
    model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    provider: 'transformers',
    task: 'sentiment',
  },
  {
    description: 'Produce a short summary of longer text.',
    label: 'Summarize',
    model: 'Xenova/distilbart-cnn-6-6',
    provider: 'transformers',
    task: 'summarize',
  },
  {
    description: 'Extractive QA over a provided context.',
    label: 'Question answering',
    model: 'Xenova/distilbert-base-uncased-distilled-squad',
    provider: 'transformers',
    task: 'question-answering',
  },
  {
    description: 'CoNLL-2003 entity groups.',
    label: 'Named entities (NER)',
    model: 'Xenova/bert-base-NER',
    provider: 'transformers',
    task: 'token-classification',
  },
  {
    description: 'Classify into arbitrary candidate labels without retraining.',
    label: 'Zero-shot classification',
    model: 'Xenova/nli-deberta-v3-xsmall',
    provider: 'transformers',
    task: 'zero-shot-classification',
  },
  {
    description: 'Dense sentence embedding.',
    label: 'Embeddings',
    model: 'onnx-community/all-MiniLM-L6-v2-ONNX',
    provider: 'transformers',
    task: 'feature-extraction',
  },
];

/**
 * The task registry exposed by the service; falls back to a static list.
 * @returns the query for the AI task registry
 */
export function useAiTasks() {
  return useQuery({ queryFn: fetchTasks, queryKey: ['ai', 'tasks'], staleTime: Infinity });
}

/**
 * Fetches and parses the registry; falls back to FALLBACK_TASKS on any failure.
 * @returns the registry descriptors
 */
async function fetchTasks(): Promise<AiTaskDescriptor[]> {
  try {
    const response = await apiFetch<{ items: unknown[] }>('/api/ai/tasks');
    const parsed = response.items
      .map((entry) => aiTaskDescriptorSchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
    return parsed.length > 0 ? parsed : FALLBACK_TASKS;
  } catch {
    return FALLBACK_TASKS;
  }
}
