import { describe, expect, it } from 'vitest';

import {
  createTranslationSchema,
  MAX_TRANSLATION_TEXT_LENGTH,
  translateRequestSchema,
  translateResponseSchema,
  translationSchema,
  updateTranslationSchema,
  wsTranslationErrorEventSchema,
  wsTranslationEventSchema,
  wsTranslateMessageSchema,
} from './translations';

describe('translateRequestSchema', () => {
  it('accepts a valid request and trims text', () => {
    const parsed = translateRequestSchema.parse({ text: '  hello  ', targetLanguage: 'fr' });
    expect(parsed.text).toBe('hello');
    expect(parsed.targetLanguage).toBe('fr');
  });

  it('rejects empty and oversized text', () => {
    expect(() => translateRequestSchema.parse({ text: '   ', targetLanguage: 'fr' })).toThrow();
    expect(() =>
      translateRequestSchema.parse({
        text: 'a'.repeat(MAX_TRANSLATION_TEXT_LENGTH + 1),
        targetLanguage: 'fr',
      }),
    ).toThrow();
  });

  it('accepts exactly MAX_TRANSLATION_TEXT_LENGTH characters', () => {
    const parsed = translateRequestSchema.parse({
      text: 'a'.repeat(MAX_TRANSLATION_TEXT_LENGTH),
      targetLanguage: 'fr',
    });
    expect(parsed.text).toHaveLength(MAX_TRANSLATION_TEXT_LENGTH);
  });

  it('rejects malformed target languages', () => {
    for (const targetLanguage of ['', 'F', 'fra', 'FR', 'f1', 12]) {
      expect(() => translateRequestSchema.parse({ text: 'hi', targetLanguage })).toThrow();
    }
  });
});

describe('translation rows', () => {
  const row = {
    id: '123e4567-e89b-42d3-a456-426655440000',
    languageId: '223e4567-e89b-42d3-a456-426655440000',
    namespace: 'static',
    key: 'home.title',
    text: 'Home',
    parentId: null,
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    deletedAt: null,
  };

  it('parses a stored row', () => {
    expect(translationSchema.parse(row).key).toBe('home.title');
  });

  it('createTranslationSchema static branch requires a key', () => {
    const parsed = createTranslationSchema.parse({
      namespace: 'static',
      languageId: row.languageId,
      text: 'Bonjour',
      key: 'greeting',
    });
    expect(parsed.key).toBe('greeting');
    expect(() =>
      createTranslationSchema.parse({
        namespace: 'static',
        languageId: row.languageId,
        text: 'Bonjour',
      }),
    ).toThrow();
  });

  it('createTranslationSchema dynamic branch derives the key server-side', () => {
    const parsed = createTranslationSchema.parse({
      namespace: 'dynamic',
      languageId: row.languageId,
      text: 'Bonjour',
    });
    expect(parsed.namespace).toBe('dynamic');
    expect(Object.keys(parsed)).toEqual(['namespace', 'languageId', 'text']);
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
    expect(translateResponseSchema.parse({ text: 'Bonjour', cached: true }).cached).toBe(true);
    expect(() => translateResponseSchema.parse({ text: 'Bonjour' })).toThrow();
  });
});

describe('ws envelopes', () => {
  const requestId = '123e4567-e89b-42d3-a456-426655440000';

  it('wsTranslateMessageSchema requires a uuid requestId and a valid target', () => {
    const parsed = wsTranslateMessageSchema.parse({ text: 'hi', targetLanguage: 'de', requestId });
    expect(parsed.requestId).toBe(requestId);
    expect(() =>
      wsTranslateMessageSchema.parse({ text: 'hi', targetLanguage: 'de', requestId: 'nope' }),
    ).toThrow();
  });

  it('wsTranslationEventSchema carries text and cached', () => {
    const parsed = wsTranslationEventSchema.parse({ requestId, text: 'Hallo', cached: false });
    expect(parsed.text).toBe('Hallo');
    expect(() => wsTranslationEventSchema.parse({ requestId, text: 'Hallo' })).toThrow();
  });

  it('wsTranslationErrorEventSchema requires a message', () => {
    expect(wsTranslationErrorEventSchema.parse({ requestId, message: 'boom' }).message).toBe(
      'boom',
    );
    expect(() => wsTranslationErrorEventSchema.parse({ requestId })).toThrow();
  });
});
