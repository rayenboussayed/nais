import { describe, expect, it } from 'vitest';

import type { SttRequest } from './audio.js';

import {
  MAX_AUDIO_BYTES,
  MAX_BASE64_LENGTH,
  sttLanguageSchema,
  sttRequestSchema,
  sttResponseSchema,
  sttSegmentSchema,
} from './audio.js';

describe('audio size limits', () => {
  it('derives the base64 cap from the decoded payload cap', () => {
    expect(MAX_AUDIO_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_BASE64_LENGTH).toBe(4 * Math.ceil(MAX_AUDIO_BYTES / 3));
  });
});

describe('sttLanguageSchema', () => {
  it('accepts both detection modes and two-letter codes', () => {
    for (const value of ['auto', 'lock', 'en', 'fr', 'ar']) {
      expect(sttLanguageSchema.parse(value)).toBe(value);
    }
  });

  it('trims two-letter codes like the shared ISO schema', () => {
    expect(sttLanguageSchema.parse('  fr  ')).toBe('fr');
  });

  it('rejects unknown codes, non-strings and uppercase tags', () => {
    for (const value of ['', 'fra', 'FR', 'zh-Hant', '11', 1, null]) {
      expect(sttLanguageSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe('sttRequestSchema', () => {
  it('accepts a base64 payload without a language', () => {
    const parsed: SttRequest = sttRequestSchema.parse({ audio: 'aGVsbG8=' });
    expect(parsed.audio).toBe('aGVsbG8=');
    expect(parsed.language).toBeUndefined();
  });

  it('accepts a language selector alongside the payload', () => {
    expect(sttRequestSchema.parse({ audio: 'aGVsbG8=', language: 'lock' }).language).toBe('lock');
    expect(sttRequestSchema.parse({ audio: 'aGVsbG8=', language: 'fr' }).language).toBe('fr');
  });

  it('accepts a payload of exactly MAX_BASE64_LENGTH characters', () => {
    const parsed = sttRequestSchema.parse({ audio: 'a'.repeat(MAX_BASE64_LENGTH) });
    expect(parsed.audio).toHaveLength(MAX_BASE64_LENGTH);
  });

  it('rejects oversized or malformed payloads', () => {
    expect(sttRequestSchema.safeParse({ audio: 'a'.repeat(MAX_BASE64_LENGTH + 4) }).success).toBe(
      false,
    );
    expect(sttRequestSchema.safeParse({ audio: 'not base64!' }).success).toBe(false);
    expect(sttRequestSchema.safeParse({ audio: '' }).success).toBe(false);
    expect(sttRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects an unknown language', () => {
    expect(sttRequestSchema.safeParse({ audio: 'aGVsbG8=', language: 'klingon' }).success).toBe(
      false,
    );
  });
});

describe('sttSegmentSchema', () => {
  it('accepts non-negative integer timestamps and text', () => {
    expect(sttSegmentSchema.parse({ end: 1200, start: 300, text: 'hello' })).toEqual({
      end: 1200,
      start: 300,
      text: 'hello',
    });
  });

  it('rejects negative, fractional or non-numeric timestamps and non-string text', () => {
    for (const segment of [
      { end: 1, start: -1, text: 'x' },
      { end: -1, start: 0, text: 'x' },
      { end: 1.5, start: 0, text: 'x' },
      { end: '1', start: 0, text: 'x' },
      { end: 1, start: 0, text: 1 },
      { end: 1, start: 0 },
    ]) {
      expect(sttSegmentSchema.safeParse(segment).success).toBe(false);
    }
  });
});

describe('sttResponseSchema', () => {
  it('accepts a full response from either device', () => {
    for (const device of ['gpu', 'cpu']) {
      const parsed = sttResponseSchema.parse({
        device,
        segments: [{ end: 900, start: 100, text: 'hello' }],
        text: 'hello',
      });
      expect(parsed.device).toBe(device);
      expect(parsed.segments).toHaveLength(1);
    }
  });

  it('accepts an empty transcript', () => {
    expect(sttResponseSchema.parse({ device: 'cpu', segments: [], text: '' }).text).toBe('');
  });

  it('rejects an unknown device or malformed segments', () => {
    expect(sttResponseSchema.safeParse({ device: 'tpu', segments: [], text: '' }).success).toBe(
      false,
    );
    expect(sttResponseSchema.safeParse({ device: 'cpu', segments: [{}], text: '' }).success).toBe(
      false,
    );
    expect(sttResponseSchema.safeParse({ device: 'cpu', text: '' }).success).toBe(false);
  });
});
