// Pre-downloads the dedicated ONNX pipelines used by the general AI service.
// Honors HF_CACHE_DIR, AI_DEVICE (unset/blank = webgpu → wasm → cpu fallback)
// and the same AI_<TASK>_MODEL overrides as the API.
// Usage: npm run build -w @trainslator/api && HF_CACHE_DIR=/hf-cache node apps/api/bin/transformers-warmup.mjs
// The built dist/ is required (the device chain lives in src/resources/ai/device.ts).
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

const failWith = (message) => {
  console.error(message);
  // eslint-disable-next-line n/no-process-exit -- hard exit: warmup must exit even though Dawn keeps the loop alive
  process.exit(1);
};

const deviceModuleUrl = new URL('../dist/resources/ai/device.js', import.meta.url);
const webgpuModuleUrl = new URL('../dist/resources/ai/webgpu-globals.js', import.meta.url);
let resolveDeviceChain;
let ensureWebgpuGlobals;
try {
  ({ resolveDeviceChain } = await import(deviceModuleUrl.href));
  ({ ensureWebgpuGlobals } = await import(webgpuModuleUrl.href));
} catch (error) {
  failWith(
    `warmup needs the built application (apps/api/dist): ${error instanceof Error ? error.message : String(error)}\nRun \`npm run build -w @trainslator/api\` first.`,
  );
}

let chain;
try {
  chain = resolveDeviceChain(process.env.AI_DEVICE);
} catch (error) {
  failWith(error instanceof Error ? error.message : String(error));
}
console.log(`device chain: ${chain.join(' → ')}`);

const started = Date.now();
const failures = [];

for (const [task, envKey, fallback] of TASKS) {
  // eslint-disable-next-line security/detect-object-injection -- envKey comes from the static TASKS table, not from the caller
  const model = process.env[envKey]?.trim() || fallback;
  const t0 = Date.now();
  let done = false;
  for (const device of chain) {
    try {
      if (device === 'webgpu') await ensureWebgpuGlobals();
      const { pipeline } = await import('@huggingface/transformers');
      const options = { ...(cacheDir ? { cache_dir: cacheDir } : {}), device };
      const instance = await pipeline(task, model, options);
      if (typeof instance.dispose === 'function') await instance.dispose();
      console.log(
        `ok    ${task} (${model}, ${device}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
      done = true;
      break;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'unknown';
      console.error(`FAIL  ${task} (${model}, ${device}): ${name}`);
    }
  }
  if (!done) failures.push(task);
}

if (failures.length > 0) {
  console.error(`transformers warmup failed for: ${failures.join(', ')}`);
  // eslint-disable-next-line n/no-process-exit -- hard exit: a failed warmup must signal failure even if pipelines keep the loop alive
  process.exit(1);
}
console.log(`transformers warmup complete in ${((Date.now() - started) / 1000).toFixed(1)}s`);
// eslint-disable-next-line n/no-process-exit -- hard exit: Dawn holds native threads that would otherwise keep the process alive
process.exit(0);
