import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads the prompt templates once, at module import. The production pair is
 * the full MQM-style translator prompt; the development pair is a minimal
 * instruction set for cheap local iterations. Layout mirrors the legacy
 * `templates/prompts/translation/{production,development}` convention.
 */
const templatesRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'templates');
const variant = process.env.NODE_ENV === 'production' ? 'production' : 'development';

const TRANSLATE_SYSTEM_PROMPT: string = readFileSync(
  path.join(templatesRoot, variant, 'system.md'),
  'utf8',
);
export const TRANSLATE_HUMAN_PROMPT: string = readFileSync(
  path.join(templatesRoot, variant, 'human.md'),
  'utf8',
);

/**
 * Conservative normalizer for model output: removes exactly one pair of
 * surrounding ASCII double quotes when the entire output is wrapped and the
 * wrapped body contains no other double quotes. Anything ambiguous is
 * returned untouched; the pipeline never rewrites content.
 */
export function stripEnclosingQuotes(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const body = trimmed.slice(1, -1);
    if (!body.includes('"')) {
      return body.trim();
    }
  }
  return trimmed;
}

/**
 * Renders the system prompt for one call. The template carries a single
 * `{TARGET_LANGUAGE}` placeholder (the self-check step); everything else is
 * static behavior text.
 */
export function buildSystemPrompt(
  targetLanguage: string,
  template: string = TRANSLATE_SYSTEM_PROMPT,
): string {
  return template.replaceAll('{TARGET_LANGUAGE}', targetLanguage);
}

/**
 * Substitutes the placeholders in the human template.
 *
 * The source text is wrapped in a nonce-tagged fence: an attacker cannot
 * predict the marker, cannot close the fence from inside the source text, and
 * the template instructs the model to treat everything inside the fence as
 * data, never as instructions.
 *
 * @param template - contents of human.md (`{TARGET_LANGUAGE}`, `{TEXT}`)
 * @param values - substitution values
 */
export function buildHumanPrompt(
  template: string,
  values: { TARGET_LANGUAGE: string; TEXT: string },
): string {
  const nonce = randomBytes(8).toString('hex');
  const begin = `<<<TRANSLATE_SOURCE:${nonce}>>>`;
  const end = `<<<END_TRANSLATE_SOURCE:${nonce}>>>`;
  return template
    .replaceAll('{TARGET_LANGUAGE}', values.TARGET_LANGUAGE)
    .replaceAll('{TEXT}', `${begin}\n${values.TEXT}\n${end}`);
}
