import { useQuery } from '@tanstack/react-query';

import type { AiTaskDescriptor } from '@trainslator/shared';
import { aiTaskDescriptorSchema } from '@trainslator/shared';

import { apiFetch } from './api';

/** Local fallback so the Studio renders even if the tasks endpoint is unreachable. */
const FALLBACK_TASKS: AiTaskDescriptor[] = [
  {
    task: 'translate',
    provider: 'ollama',
    model: 'bonsai-2:2b',
    label: 'Translate',
    description: 'Translate text into a target language.',
  },
  {
    task: 'sentiment',
    provider: 'transformers',
    model: 'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
    label: 'Sentiment',
    description: 'Binary SST-2 sentiment with a confidence score.',
  },
  {
    task: 'summarize',
    provider: 'transformers',
    model: 'Xenova/distilbart-cnn-6-6',
    label: 'Summarize',
    description: 'Produce a short summary of longer text.',
  },
  {
    task: 'question-answering',
    provider: 'transformers',
    model: 'Xenova/distilbert-base-uncased-distilled-squad',
    label: 'Question answering',
    description: 'Extractive QA over a provided context.',
  },
  {
    task: 'token-classification',
    provider: 'transformers',
    model: 'Xenova/bert-base-NER',
    label: 'Named entities (NER)',
    description: 'CoNLL-2003 entity groups.',
  },
  {
    task: 'zero-shot-classification',
    provider: 'transformers',
    model: 'Xenova/nli-deberta-v3-xsmall',
    label: 'Zero-shot classification',
    description: 'Classify into arbitrary candidate labels without retraining.',
  },
  {
    task: 'feature-extraction',
    provider: 'transformers',
    model: 'onnx-community/all-MiniLM-L6-v2-ONNX',
    label: 'Embeddings',
    description: 'Dense sentence embedding.',
  },
];

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

/** The task registry exposed by the service; falls back to a static list. */
export function useAiTasks() {
  return useQuery({ queryKey: ['ai', 'tasks'], queryFn: fetchTasks, staleTime: Infinity });
}
