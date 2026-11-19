#!/usr/bin/env node
// Verifies the Ollama endpoint advertises the configured text model.
// Usage: OLLAMA_BASE_URL=http://localhost:11434 OLLAMA_TEXT_MODEL=bonsai-2:2b node scripts/ollama-smoke.mjs
const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const model = process.env.OLLAMA_TEXT_MODEL ?? 'bonsai-2:2b';

const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(10_000) });
if (!res.ok) {
  console.error(`ollama responded with ${res.status}`);
  process.exit(1);
}

const tags = await res.json();
const names = (tags.models ?? []).map((entry) => entry.name);
const baseName = model.split(':')[0];
const found = names.some((name) => name === model || name.startsWith(`${baseName}:`));

console.log('models:', names.join(', ') || '(none)');
console.log(found ? `ok: ${model} is available` : `missing: ${model}`);
process.exit(found ? 0 : 1);
