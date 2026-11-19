// Pre-downloads the dedicated ONNX pipelines used by the general AI service.
// Honors HF_CACHE_DIR and the same AI_<TASK>_MODEL overrides as the API.
// Usage: HF_CACHE_DIR=/hf-cache node apps/api/bin/transformers-warmup.mjs
'use strict';

const TASKS = [
  [
    'sentiment-analysis',
    'AI_SENTIMENT_MODEL',
    'Xenova/distilbert-base-uncased-finetuned-sst-2-english',
  ],
  ['summarization', 'AI_SUMMARIZE_MODEL', 'Xenova/distilbart-cnn-6-6'],
  [
    'question-answering',
    'AI_QUESTION_ANSWERING_MODEL',
    'Xenova/distilbert-base-uncased-distilled-squad',
  ],
  ['token-classification', 'AI_TOKEN_CLASSIFICATION_MODEL', 'Xenova/bert-base-NER'],
  ['zero-shot-classification', 'AI_ZERO_SHOT_CLASSIFICATION_MODEL', 'Xenova/nli-deberta-v3-xsmall'],
  ['feature-extraction', 'AI_FEATURE_EXTRACTION_MODEL', 'onnx-community/all-MiniLM-L6-v2-ONNX'],
];

const cacheDir = process.env.HF_CACHE_DIR;
const started = Date.now();
const failures = [];

for (const [task, envKey, fallback] of TASKS) {
  // eslint-disable-next-line security/detect-object-injection -- envKey comes from the static TASKS table, not from the caller
  const model = process.env[envKey]?.trim() || fallback;
  const t0 = Date.now();
  try {
    const { pipeline } = await import('@huggingface/transformers');
    const options = cacheDir ? { cache_dir: cacheDir } : {};
    const instance = await pipeline(task, model, options);
    if (typeof instance.dispose === 'function') await instance.dispose();
    console.log(`ok    ${task} (${model}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (error) {
    const name = error instanceof Error ? error.name : 'unknown';
    console.error(`FAIL  ${task} (${model}): ${name}`);
    failures.push(task);
  }
}

if (failures.length > 0) {
  console.error(`transformers warmup failed for: ${failures.join(', ')}`);
  // eslint-disable-next-line n/no-process-exit -- hard exit: a failed warmup must signal failure even if pipelines keep the loop alive
  process.exit(1);
}
console.log(`transformers warmup complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
