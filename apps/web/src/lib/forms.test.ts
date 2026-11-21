import { describe, expect, it } from 'vitest';

import {
  aiTaskDescriptorSchema,
  createLanguageSchema,
  createTranslationSchema,
  updateLanguageBodySchema,
  updateTranslationBodySchema,
} from './forms';

const languageId = '123e4567-e89b-42d3-a456-426655440000';

describe('createLanguageSchema', () => {
  it('parses a full input, defaults isSource and trims names', () => {
    const parsed = createLanguageSchema.safeParse({
      dir: 'rtl',
      iso6391: 'ar',
      name: '  Arabic  ',
      nativeName: ' العربية ',
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.isSource).toBe(false);
    expect(parsed.data.name).toBe('Arabic');
    expect(parsed.data.nativeName).toBe('العربية');
  });

  it('rejects missing required fields with a first issue message', () => {
    for (const draft of [
      { name: 'Arabic' },
      { iso6391: 'ar', name: 'Arabic', nativeName: 'العربية' },
    ]) {
      const parsed = createLanguageSchema.safeParse(draft);
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(typeof parsed.error.issues[0]?.message).toBe('string');
    }
  });

  it('rejects names longer than 255 characters', () => {
    for (const draft of [
      { dir: 'ltr', iso6391: 'en', name: 'x'.repeat(256), nativeName: 'y' },
      { dir: 'ltr', iso6391: 'en', name: 'English', nativeName: 'y'.repeat(256) },
    ]) {
      const parsed = createLanguageSchema.safeParse(draft);
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(typeof parsed.error.issues[0]?.message).toBe('string');
    }
  });

  it('rejects invalid enum and code values with a first issue message', () => {
    for (const draft of [
      { dir: 'up', iso6391: 'en', name: 'n', nativeName: 'n' },
      { dir: 'ltr', iso6391: 'eng', name: 'n', nativeName: 'n' },
    ]) {
      const parsed = createLanguageSchema.safeParse(draft);
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(typeof parsed.error.issues[0]?.message).toBe('string');
    }
  });
});

describe('updateLanguageBodySchema', () => {
  it('rejects an empty patch with the first-issue message', () => {
    const parsed = updateLanguageBodySchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe('Provide at least one field');
  });

  it('accepts a single defined field', () => {
    const parsed = updateLanguageBodySchema.safeParse({ isSource: true });
    expect(parsed.success && parsed.data.isSource).toBe(true);
  });

  it('accepts an iso-only patch and keeps the parsed value', () => {
    const parsed = updateLanguageBodySchema.safeParse({ iso6391: 'de' });
    expect(parsed.success && parsed.data.iso6391).toBe('de');
  });

  it('rejects an undefined-only patch with the refine message', () => {
    const parsed = updateLanguageBodySchema.safeParse({ isSource: undefined });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe('Provide at least one field');
  });
});

describe('createTranslationSchema', () => {
  it('keeps the static branch key and the dynamic branch key-free', () => {
    const staticRow = createTranslationSchema.safeParse({
      key: 'greeting',
      languageId,
      namespace: 'static',
      text: 'Bonjour',
    });
    expect(staticRow.success).toBe(true);
    expect(staticRow.success && 'key' in staticRow.data && staticRow.data.key).toBe('greeting');

    const dynamicRow = createTranslationSchema.safeParse({
      languageId,
      namespace: 'dynamic',
      text: 'Bonjour',
    });
    expect(dynamicRow.success).toBe(true);
    if (dynamicRow.success) {
      expect(Object.keys(dynamicRow.data).sort()).toEqual(['languageId', 'namespace', 'text']);
    }
  });

  it('rejects a static row without a key and a row without a namespace', () => {
    for (const payload of [
      { languageId, namespace: 'static', text: 'Bonjour' },
      { languageId, text: 'Bonjour' },
    ]) {
      const parsed = createTranslationSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(typeof parsed.error.issues[0]?.message).toBe('string');
    }
  });

  it('rejects missing required fields with a first issue message', () => {
    for (const payload of [
      { languageId, namespace: 'dynamic' },
      { namespace: 'dynamic', text: 'Bonjour' },
    ]) {
      const parsed = createTranslationSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(typeof parsed.error.issues[0]?.message).toBe('string');
    }
  });

  it('rejects a static key longer than 255 characters', () => {
    const parsed = createTranslationSchema.safeParse({
      key: 'k'.repeat(256),
      languageId,
      namespace: 'static',
      text: 'Bonjour',
    });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(typeof parsed.error.issues[0]?.message).toBe('string');
  });
});

describe('updateTranslationBodySchema', () => {
  it('rejects an empty patch with the first-issue message', () => {
    const parsed = updateTranslationBodySchema.safeParse({});
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe('Provide at least one field');
  });

  it('accepts a text-only patch', () => {
    const parsed = updateTranslationBodySchema.safeParse({ text: 'updated' });
    expect(parsed.success && parsed.data.text).toBe('updated');
  });

  it('rejects an undefined-only patch with the refine message', () => {
    const parsed = updateTranslationBodySchema.safeParse({ text: undefined });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe('Provide at least one field');
  });
});

describe('aiTaskDescriptorSchema', () => {
  const descriptor = {
    description: 'Translate into a language',
    label: 'Translate',
    model: 'bonsai-2:2b',
    provider: 'ollama',
    task: 'translate',
  };

  it('parses a valid registry descriptor', () => {
    const parsed = aiTaskDescriptorSchema.safeParse(descriptor);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.description).toBe('Translate into a language');
      expect(parsed.data.label).toBe('Translate');
      expect(parsed.data.model).toBe('bonsai-2:2b');
      expect(parsed.data.provider).toBe('ollama');
      expect(parsed.data.task).toBe('translate');
    }
  });

  it('accepts a transformers descriptor with a non-translate task', () => {
    const parsed = aiTaskDescriptorSchema.safeParse({
      description: 'Dense sentence embedding',
      label: 'Embeddings',
      model: 'onnx-community/all-MiniLM-L6-v2-ONNX',
      provider: 'transformers',
      task: 'feature-extraction',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.provider).toBe('transformers');
      expect(parsed.data.task).toBe('feature-extraction');
    }
  });

  it('rejects an unknown task with a first issue message', () => {
    const parsed = aiTaskDescriptorSchema.safeParse({ ...descriptor, task: 'unknown' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(typeof parsed.error.issues[0]?.message).toBe('string');
  });

  it('rejects an unknown provider and missing required fields', () => {
    for (const payload of [
      { ...descriptor, provider: 'unknown' },
      { ...descriptor, description: undefined },
      { ...descriptor, label: undefined },
      { ...descriptor, model: undefined },
    ]) {
      const parsed = aiTaskDescriptorSchema.safeParse(payload);
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(typeof parsed.error.issues[0]?.message).toBe('string');
    }
  });
});
