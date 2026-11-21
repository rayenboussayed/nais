import { BadGatewayException } from '@nestjs/common';

import type { AiTask } from '../schemas/ai.js';

import { aiResultSchemas } from '../schemas/ai.js';

/**
 * Return the first item of a list-task pipeline output.
 * @param raw - the raw pipeline output
 * @param task - the task whose output is being validated
 * @returns the first item of the output array
 * @throws BadGatewayException when the output is not an array or is empty
 */
export function firstItem(raw: unknown, task: AiTask): Record<string, unknown> {
  const items = arrayItems(raw, task);
  const first = items[0];
  if (!first) throw new BadGatewayException(`The ${task} model returned no output`);
  return first;
}

/**
 * Extract a flat numeric vector from a tensor's `tolist()` result.
 * @param listed - the value returned by `tolist()`
 * @returns the flat vector, or null when no flat numeric vector is present
 */
export function firstVector(listed: unknown): null | number[] {
  if (!Array.isArray(listed) || listed.length === 0) return null;
  const first: unknown = listed[0];
  if (Array.isArray(first) && first.length > 0 && typeof first[0] === 'number') {
    return first;
  }
  if (typeof first === 'number') return listed;
  return null;
}

/**
 * Normalizes raw pipeline output into the task's shared result schema.
 * @param task - the task the output belongs to
 * @param raw - the raw pipeline output
 * @returns the schema-validated result object
 */
export function normalizeResult(
  task: Exclude<AiTask, 'translate'>,
  raw: unknown,
): Record<string, unknown> {
  switch (task) {
    case 'feature-extraction': {
      const embedding = tensorToArray(raw);
      return aiResultSchemas['feature-extraction'].parse({
        cached: false,
        dimensions: embedding.length,
        embedding,
      });
    }
    case 'question-answering': {
      const item = singleItem(raw, task);
      return aiResultSchemas['question-answering'].parse({
        answer: String(item.answer ?? ''),
        cached: false,
        end: Number(item.end ?? 0),
        score: Number(item.score ?? 0),
        start: Number(item.start ?? 0),
      });
    }
    case 'sentiment': {
      const first = firstItem(raw, task);
      return aiResultSchemas.sentiment.parse({
        cached: false,
        label: String(first.label ?? ''),
        score: Number(first.score ?? 0),
      });
    }
    case 'summarize': {
      const first = firstItem(raw, task);
      return aiResultSchemas.summarize.parse({
        cached: false,
        text: String(first.summary_text ?? '').trim(),
      });
    }
    case 'token-classification': {
      const items = arrayItems(raw, task);
      return aiResultSchemas['token-classification'].parse({
        cached: false,
        entities: items.map((item) => ({
          end: Number(item.end ?? 0),
          entity_group: String(item.entity_group ?? item.entity ?? ''),
          score: Number(item.score ?? 0),
          start: Number(item.start ?? 0),
          word: String(item.word ?? ''),
        })),
      });
    }
    case 'zero-shot-classification': {
      // The pipeline returns a single object for a single input string.
      const item = singleItem(raw, task);
      return aiResultSchemas['zero-shot-classification'].parse({
        cached: false,
        labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label)) : [],
        scores: Array.isArray(item.scores) ? item.scores.map((score) => Number(score ?? 0)) : [],
        sequence: String(item.sequence ?? ''),
      });
    }
  }
}

/**
 * Validate that a raw pipeline output is a single object, not an array or primitive.
 * @param raw - the raw pipeline output
 * @param task - the task whose output is being validated
 * @returns the output narrowed to a record
 * @throws BadGatewayException when the output is not a non-null, non-array object
 */
export function singleItem(raw: unknown, task: AiTask): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new BadGatewayException(`The ${task} model returned an unexpected shape`);
  }
  return raw as Record<string, unknown>;
}

/**
 * Extracts a flat embedding vector from a transformers.js Tensor-like object.
 * @param raw - the tensor-like object returned by feature-extraction
 * @returns the flat embedding vector as plain numbers
 * @throws BadGatewayException when neither `tolist()` nor `data` yields a vector
 */
export function tensorToArray(raw: unknown): number[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new BadGatewayException('The feature-extraction model returned an unexpected shape');
  }
  const tensor = raw as {
    data?: Array<number> | ArrayLike<number> | Float32Array | { length: number };
    tolist?: () => unknown;
  };
  if (typeof tensor.tolist === 'function') {
    const listed = tensor.tolist();
    const flat = firstVector(listed);
    if (flat) return flat;
  }
  const data = tensor.data;
  if (data && ArrayLikeCheck(data)) {
    // Number() also accepts BigInt entries from int8/uint8 quantized tensors.
    return Array.from(data as ArrayLike<bigint | number>, (value) => Number(value));
  }
  throw new BadGatewayException('The feature-extraction model returned an unexpected shape');
}

/**
 * Narrow a raw pipeline output to the array shape that list tasks return.
 * @param raw - the raw pipeline output
 * @param task - the task whose output is being validated
 * @returns the output narrowed to an array of record items
 * @throws BadGatewayException when the output is not an array
 */
function arrayItems(raw: unknown, task: AiTask): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) {
    throw new BadGatewayException(`The ${task} model returned an unexpected shape`);
  }
  return raw;
}

/**
 * ArrayLike narrowing with an explicit check of the length property.
 * @param value - the unknown value narrowed to ArrayLike
 * @returns true when the value has a numeric `length` property
 */
function ArrayLikeCheck(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'length' in value &&
    typeof (value as { length: unknown }).length === 'number'
  );
}
