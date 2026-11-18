import { describe, expect, it } from 'vitest';

import { aiMessageSchema, aiMessagePromptSchema } from './ai-messages';

describe('aiMessageSchema', () => {
  it('parses an audit row with usage accounting', () => {
    const parsed = aiMessageSchema.parse({
      id: '123e4567-e89b-42d3-a456-426655440000',
      provider: 'ollama',
      model: 'bonsai-2:2b',
      status: 'completed',
      response: 'Bonjour le monde',
      usage: { inputTokens: 12, outputTokens: 34, model: 'bonsai-2:2b' },
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
      deletedAt: null,
    });
    expect(parsed.usage?.inputTokens).toBe(12);
  });

  it('allows null response and usage for failed calls', () => {
    const parsed = aiMessageSchema.parse({
      id: '123e4567-e89b-42d3-a456-426655440000',
      provider: 'ollama',
      model: 'bonsai-2:2b',
      status: 'failed',
      response: null,
      usage: null,
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
      deletedAt: null,
    });
    expect(parsed.status).toBe('failed');
  });

  it('rejects unknown statuses', () => {
    expect(() =>
      aiMessageSchema.parse({
        id: '123e4567-e89b-42d3-a456-426655440000',
        provider: 'ollama',
        model: 'm',
        status: 'exploded',
        response: null,
        usage: null,
        createdAt: '2026-11-18T00:00:00.000Z',
        updatedAt: '2026-11-18T00:00:00.000Z',
        deletedAt: null,
      }),
    ).toThrow();
  });
});

describe('aiMessagePromptSchema', () => {
  it('parses a stored prompt', () => {
    const parsed = aiMessagePromptSchema.parse({
      id: '123e4567-e89b-42d3-a456-426655440000',
      messageId: '223e4567-e89b-42d3-a456-426655440000',
      role: 'system',
      prompt: 'You are a professional translator.',
      createdAt: '2026-11-18T00:00:00.000Z',
    });
    expect(parsed.role).toBe('system');
  });

  it('rejects roles longer than 10 characters', () => {
    expect(() =>
      aiMessagePromptSchema.parse({
        id: '123e4567-e89b-42d3-a456-426655440000',
        messageId: '223e4567-e89b-42d3-a456-426655440000',
        role: 'x'.repeat(11),
        prompt: 'p',
        createdAt: '2026-11-18T00:00:00.000Z',
      }),
    ).toThrow();
  });
});
