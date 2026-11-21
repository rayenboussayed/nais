import { describe, expect, it } from 'vitest';

import { aiMessageStatusSchema, languageDirSchema, translationNamespaceSchema } from './enums.js';

describe('enums', () => {
  it('translationNamespaceSchema accepts static and dynamic', () => {
    expect(translationNamespaceSchema.parse('static')).toBe('static');
    expect(translationNamespaceSchema.parse('dynamic')).toBe('dynamic');
  });

  it('translationNamespaceSchema rejects unknown namespaces', () => {
    expect(() => translationNamespaceSchema.parse('cms')).toThrow();
    expect(() => translationNamespaceSchema.parse('')).toThrow();
    expect(() => translationNamespaceSchema.parse(1)).toThrow();
  });

  it('languageDirSchema accepts ltr and rtl', () => {
    expect(languageDirSchema.parse('ltr')).toBe('ltr');
    expect(languageDirSchema.parse('rtl')).toBe('rtl');
  });

  it('languageDirSchema rejects anything else', () => {
    expect(() => languageDirSchema.parse('up')).toThrow();
    expect(() => languageDirSchema.parse('LTR')).toThrow();
  });

  it('aiMessageStatusSchema accepts the full lifecycle', () => {
    for (const status of ['pending', 'processing', 'completed', 'failed'] as const) {
      expect(aiMessageStatusSchema.parse(status)).toBe(status);
    }
  });

  it('aiMessageStatusSchema rejects unknown statuses', () => {
    expect(() => aiMessageStatusSchema.parse('running')).toThrow();
  });
});
