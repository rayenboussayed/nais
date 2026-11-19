import { describe, expect, it } from 'vitest';

import {
  TRANSLATE_HUMAN_PROMPT,
  buildHumanPrompt,
  buildSystemPrompt,
  stripEnclosingQuotes,
} from './prompts';

describe('buildSystemPrompt', () => {
  it('substitutes every TARGET_LANGUAGE occurrence and leaves none behind', () => {
    const rendered = buildSystemPrompt(
      'French',
      'native {TARGET_LANGUAGE} speaker, asks {TARGET_LANGUAGE}',
    );
    expect(rendered).toBe('native French speaker, asks French');
  });

  it('works against the real template without throwing', () => {
    const rendered = buildSystemPrompt('French');
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered).not.toContain('{TARGET_LANGUAGE}');
  });
});

describe('buildHumanPrompt', () => {
  it('substitutes both placeholders and leaves no template tokens behind', () => {
    const rendered = buildHumanPrompt(TRANSLATE_HUMAN_PROMPT, {
      TARGET_LANGUAGE: 'Arabic',
      TEXT: 'hello world',
    });
    expect(rendered).toContain('Arabic');
    expect(rendered).toContain('hello world');
    expect(rendered).not.toContain('{TARGET_LANGUAGE}');
    expect(rendered).not.toContain('{TEXT}');
  });

  it('does not rescan substituted text for further placeholders', () => {
    const rendered = buildHumanPrompt('{TEXT} after', {
      TARGET_LANGUAGE: 'French',
      TEXT: '{TARGET_LANGUAGE}',
    });
    expect(rendered).toBe('{TARGET_LANGUAGE} after');
  });
});

describe('stripEnclosingQuotes', () => {
  it('removes one pair of wrapping quotes when the body has no quotes', () => {
    expect(stripEnclosingQuotes('"bonjour le monde"')).toBe('bonjour le monde');
    expect(stripEnclosingQuotes('  "bonjour"  ')).toBe('bonjour');
  });

  it('leaves output with inner quotes untouched', () => {
    expect(stripEnclosingQuotes('"il a dit "bonjour""')).toBe('"il a dit "bonjour""');
  });

  it('leaves unquoted output and edge-quote-only output untouched', () => {
    expect(stripEnclosingQuotes('bonjour')).toBe('bonjour');
    expect(stripEnclosingQuotes('"bonjour')).toBe('"bonjour');
    expect(stripEnclosingQuotes('bonjour"')).toBe('bonjour"');
    expect(stripEnclosingQuotes('"a" extra "b"')).toBe('"a" extra "b"');
  });
});
