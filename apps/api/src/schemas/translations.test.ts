import { describe, expect, it } from 'vitest';

import {
  createTranslationSchema,
  MAX_TRANSLATION_TEXT_LENGTH,
  translateRequestSchema,
  translateResponseSchema,
  translationSchema,
  updateTranslationBodySchema,
  updateTranslationSchema,
  wsTranslateAckSchema,
  wsTranslateMessageSchema,
  wsTranslationErrorEventSchema,
  wsTranslationEventSchema,
} from './translations.js';

describe('translateRequestSchema', () => {
  it('accepts a valid request and trims text', () => {
    const parsed = translateRequestSchema.parse({ targetLanguage: 'fr', text: '  hello  ' });
    expect(parsed.text).toBe('hello');
    expect(parsed.targetLanguage).toBe('fr');
  });

  it('rejects empty and oversized text', () => {
    expect(() => translateRequestSchema.parse({ targetLanguage: 'fr', text: '   ' })).toThrow();
    expect(() =>
      translateRequestSchema.parse({
        targetLanguage: 'fr',
        text: 'a'.repeat(MAX_TRANSLATION_TEXT_LENGTH + 1),
      }),
    ).toThrow();
  });

  it('accepts exactly MAX_TRANSLATION_TEXT_LENGTH characters', () => {
    const parsed = translateRequestSchema.parse({
      targetLanguage: 'fr',
      text: 'a'.repeat(MAX_TRANSLATION_TEXT_LENGTH),
    });
    expect(parsed.text).toHaveLength(MAX_TRANSLATION_TEXT_LENGTH);
  });

  it('rejects malformed target languages', () => {
    for (const targetLanguage of ['', 'F', 'fra', 'FR', 'f1', 12]) {
      expect(() => translateRequestSchema.parse({ targetLanguage, text: 'hi' })).toThrow();
    }
  });
});

describe('translation rows', () => {
  const row = {
    createdAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
    id: '123e4567-e89b-42d3-a456-426655440000',
    key: 'home.title',
    languageId: '223e4567-e89b-42d3-a456-426655440000',
    namespace: 'static',
    parentId: null,
    text: 'Home',
    updatedAt: '2026-11-18T00:00:00.000Z',
  };

  it('parses a stored row', () => {
    expect(translationSchema.parse(row).key).toBe('home.title');
  });

  it('createTranslationSchema static branch requires a key', () => {
    const parsed = createTranslationSchema.parse({
      key: 'greeting',
      languageId: row.languageId,
      namespace: 'static',
      text: 'Bonjour',
    });
    expect(parsed).toMatchObject({ key: 'greeting' });
    expect(() =>
      createTranslationSchema.parse({
        languageId: row.languageId,
        namespace: 'static',
        text: 'Bonjour',
      }),
    ).toThrow();
  });

  it('createTranslationSchema dynamic branch derives the key server-side', () => {
    const parsed = createTranslationSchema.parse({
      languageId: row.languageId,
      namespace: 'dynamic',
      text: 'Bonjour',
    });
    expect(parsed.namespace).toBe('dynamic');
    expect([...Object.keys(parsed)].sort()).toEqual(['languageId', 'namespace', 'text']);
  });

  it('createTranslationSchema requires namespace', () => {
    expect(() =>
      createTranslationSchema.parse({ languageId: row.languageId, text: 'Bonjour' }),
    ).toThrow();
  });

  it('updateTranslationSchema rejects a patch with no fields besides id', () => {
    expect(() => updateTranslationSchema.parse({ id: row.id })).toThrow();
  });

  it('updateTranslationSchema accepts a text-only patch', () => {
    expect(updateTranslationSchema.parse({ id: row.id, text: 'updated' }).text).toBe('updated');
  });

  it('updateTranslationBodySchema accepts a single field and rejects empty patches', () => {
    expect(updateTranslationBodySchema.parse({ text: 'hi' }).text).toBe('hi');
    expect(() => updateTranslationBodySchema.parse({})).toThrow();
    expect(() => updateTranslationBodySchema.parse({ text: undefined })).toThrow();
  });

  it('updateTranslationSchema rejects undefined-only patches', () => {
    expect(() => updateTranslationSchema.parse({ id: row.id, text: undefined })).toThrow();
  });

  it('updateTranslationSchema counts a null parentId as a provided field', () => {
    expect(updateTranslationSchema.parse({ id: row.id, parentId: null }).parentId).toBeNull();
  });

  it('translationSchema accepts offset datetimes as well as Z', () => {
    expect(
      translationSchema.parse({ ...row, createdAt: '2026-11-18T00:00:00.000+00:00' }).createdAt,
    ).toBe('2026-11-18T00:00:00.000+00:00');
  });

  it('translateResponseSchema requires the cached flag', () => {
    expect(translateResponseSchema.parse({ cached: true, text: 'Bonjour' }).cached).toBe(true);
    expect(() => translateResponseSchema.parse({ text: 'Bonjour' })).toThrow();
  });
});

describe('ws envelopes', () => {
  const requestId = '123e4567-e89b-42d3-a456-426655440000';

  it('wsTranslateMessageSchema requires a uuid requestId and a valid target', () => {
    const parsed = wsTranslateMessageSchema.parse({ requestId, targetLanguage: 'de', text: 'hi' });
    expect(parsed.requestId).toBe(requestId);
    expect(() =>
      wsTranslateMessageSchema.parse({ requestId: 'nope', targetLanguage: 'de', text: 'hi' }),
    ).toThrow();
  });

  it('wsTranslationEventSchema carries text and cached', () => {
    const parsed = wsTranslationEventSchema.parse({ cached: false, requestId, text: 'Hallo' });
    expect(parsed.text).toBe('Hallo');
    expect(() => wsTranslationEventSchema.parse({ requestId, text: 'Hallo' })).toThrow();
  });

  it('answers a structurally invalid ack-shaped payload with a validation error', () => {
    expect(() =>
      wsTranslateAckSchema.parse({
        data: null,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        statusCode: 201,
      }),
    ).toThrow();
  });

  it('parses a 400 ack with a null requestId and keeps a valid one when present', () => {
    const garbage = wsTranslateAckSchema.parse({ data: null, requestId: null, statusCode: 400 });
    expect(garbage.requestId).toBeNull();

    const kept = wsTranslateAckSchema.parse({
      data: null,
      requestId: '123e4567-e89b-42d3-a456-426655440000',
      statusCode: 400,
    });
    expect(kept.requestId).toBe('123e4567-e89b-42d3-a456-426655440000');
  });

  it('parses a 429 ack with retryAfterMs and a 500 ack', () => {
    const limited = wsTranslateAckSchema.parse({
      data: null,
      requestId: '123e4567-e89b-42d3-a456-426655440000',
      retryAfterMs: 60_000,
      statusCode: 429,
    });
    expect(limited.retryAfterMs).toBe(60_000);

    const failed = wsTranslateAckSchema.parse({
      data: null,
      requestId: '123e4567-e89b-42d3-a456-426655440000',
      statusCode: 500,
    });
    expect(failed.statusCode).toBe(500);
  });

  it('wsTranslationErrorEventSchema requires a message', () => {
    expect(wsTranslationErrorEventSchema.parse({ message: 'boom', requestId }).message).toBe(
      'boom',
    );
    expect(() => wsTranslationErrorEventSchema.parse({ requestId })).toThrow();
  });
});
