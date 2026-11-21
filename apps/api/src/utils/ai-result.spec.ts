import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { firstItem, firstVector, normalizeResult, singleItem, tensorToArray } from './ai-result.js';

describe('firstItem', () => {
  it('returns the first entry of a list output', () => {
    expect(firstItem([{ label: 'POSITIVE' }, { label: 'NEGATIVE' }], 'sentiment')).toEqual({
      label: 'POSITIVE',
    });
  });

  it('throws the task-specific message on empty output', () => {
    expect(() => firstItem([], 'sentiment')).toThrowError(BadGatewayException);
    expect(() => firstItem([], 'sentiment')).toThrow('The sentiment model returned no output');
  });

  it('throws the task-specific message on a non-array output', () => {
    expect(() => firstItem({ label: 'POSITIVE' }, 'sentiment')).toThrowError(BadGatewayException);
    expect(() => firstItem({ label: 'POSITIVE' }, 'sentiment')).toThrow(
      'The sentiment model returned an unexpected shape',
    );
  });
});

describe('firstVector', () => {
  it('flattens a nested tensor vector', () => {
    expect(firstVector([[0.1, 0.2, 0.3]])).toEqual([0.1, 0.2, 0.3]);
  });

  it('accepts a flat numeric vector', () => {
    expect(firstVector([0.5, 0.25])).toEqual([0.5, 0.25]);
  });

  it('returns null for empty or non-array input', () => {
    expect(firstVector([])).toBeNull();
    expect(firstVector('nope')).toBeNull();
  });

  it('returns null when the nested vector is empty or non-numeric', () => {
    expect(firstVector([[]])).toBeNull();
    expect(firstVector([['x']])).toBeNull();
    expect(firstVector([{}])).toBeNull();
  });
});

describe('singleItem', () => {
  it('returns a plain object unchanged', () => {
    const item = { answer: 'caf\u00e9', score: 0.5 };
    expect(singleItem(item, 'question-answering')).toBe(item);
  });

  it('throws the task-specific message for arrays, null and primitives', () => {
    for (const raw of [[], null, 'text', 42] as const) {
      expect(() => singleItem(raw, 'question-answering')).toThrowError(BadGatewayException);
      expect(() => singleItem(raw, 'question-answering')).toThrow(
        'The question-answering model returned an unexpected shape',
      );
    }
  });
});

describe('tensorToArray', () => {
  it('flattens a nested tolist() result', () => {
    expect(tensorToArray({ tolist: () => [[0.1, 0.2]] })).toEqual([0.1, 0.2]);
  });

  it('flattens a one-dimensional tolist() result', () => {
    expect(tensorToArray({ tolist: () => [0.5, 0.25] })).toEqual([0.5, 0.25]);
  });

  it('reads a typed-array data field when tolist() is absent', () => {
    expect(tensorToArray({ data: new Float32Array([0.25, 0.75]) })).toEqual([0.25, 0.75]);
  });

  it('coerces bigint entries from quantized tensors to numbers', () => {
    expect(tensorToArray({ data: new BigInt64Array([1n, 2n]) })).toEqual([1, 2]);
  });

  it('falls through to data when tolist() yields no flat vector', () => {
    expect(tensorToArray({ data: [0.3, 0.7], tolist: () => [['x']] })).toEqual([0.3, 0.7]);
  });

  it('throws when neither tolist() nor a usable data field exists', () => {
    const shapes = [
      {},
      null,
      'raw',
      { data: 42 },
      { data: {} },
      { data: { length: 'nope' } },
      { tolist: () => 42 },
    ] as const;
    for (const raw of shapes) {
      expect(() => tensorToArray(raw)).toThrowError(BadGatewayException);
      expect(() => tensorToArray(raw)).toThrow(
        'The feature-extraction model returned an unexpected shape',
      );
    }
  });
});

describe('normalizeResult', () => {
  it('normalizes nested feature-extraction tensors into an embedding', () => {
    expect(normalizeResult('feature-extraction', { tolist: () => [[0.1, 0.2, 0.3]] })).toEqual({
      cached: false,
      dimensions: 3,
      embedding: [0.1, 0.2, 0.3],
    });
  });

  it('preserves unicode labels and defaults a missing sentiment score', () => {
    expect(normalizeResult('sentiment', [{ label: 'caf\u00e9 \ud83d\ude00' }])).toEqual({
      cached: false,
      label: 'caf\u00e9 \ud83d\ude00',
      score: 0,
    });
  });

  it('trims padded unicode summarize output', () => {
    expect(normalizeResult('summarize', [{ summary_text: '  r\u00e9sum\u00e9  ' }])).toEqual({
      cached: false,
      text: 'r\u00e9sum\u00e9',
    });
  });

  it('fills missing QA offsets and coerces string-valued fields', () => {
    expect(
      normalizeResult('question-answering', {
        answer: 'a nice puppet',
        end: '4',
        score: '0.5',
        start: '2',
      }),
    ).toEqual({ answer: 'a nice puppet', cached: false, end: 4, score: 0.5, start: 2 });
  });

  it('normalizes an empty entity list and falls back from entity_group to entity', () => {
    expect(normalizeResult('token-classification', [])).toEqual({ cached: false, entities: [] });
    expect(
      normalizeResult('token-classification', [
        { end: 3, entity: 'B-PER', score: 0.5, start: 0, word: 'Ann' },
        {},
      ]),
    ).toEqual({
      cached: false,
      entities: [
        { end: 3, entity_group: 'B-PER', score: 0.5, start: 0, word: 'Ann' },
        { end: 0, entity_group: '', score: 0, start: 0, word: '' },
      ],
    });
  });

  it('preserves zero-shot label order and maps null scores to zero', () => {
    expect(
      normalizeResult('zero-shot-classification', {
        labels: ['caf\u00e9', 'th\u00e9'],
        scores: [0.12, null],
        sequence: 'un caf\u00e9',
      }),
    ).toEqual({
      cached: false,
      labels: ['caf\u00e9', 'th\u00e9'],
      scores: [0.12, 0],
      sequence: 'un caf\u00e9',
    });
  });

  it('defaults missing zero-shot arrays and sequence to empty values', () => {
    expect(normalizeResult('zero-shot-classification', {})).toEqual({
      cached: false,
      labels: [],
      scores: [],
      sequence: '',
    });
  });

  it('propagates a schema rejection for an unparseable score', () => {
    expect(() =>
      normalizeResult('zero-shot-classification', {
        labels: ['a'],
        scores: [Number.NaN],
        sequence: 'seq',
      }),
    ).toThrow();
  });

  it('throws the task-shaped BadGateway error for adversarial shapes', () => {
    expect(() => normalizeResult('sentiment', 'not an array')).toThrow(
      'The sentiment model returned an unexpected shape',
    );
    expect(() => normalizeResult('question-answering', [{ answer: 'x' }])).toThrow(
      'The question-answering model returned an unexpected shape',
    );
    expect(() => normalizeResult('feature-extraction', {})).toThrow(
      'The feature-extraction model returned an unexpected shape',
    );
  });
});
