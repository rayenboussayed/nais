import { describe, expect, it } from 'vitest';

import { aiMessagePromptSchema, aiMessageSchema } from './ai-messages';

describe('aiMessageSchema', () => {
  it('parses an audit row with usage accounting', () => {
    const parsed = aiMessageSchema.parse({
      createdAt: '2026-11-18T00:00:00.000Z',
      deletedAt: null,
      id: '123e4567-e89b-42d3-a456-426655440000',
      model: 'bonsai-2:2b',
      provider: 'ollama',
      response: 'Bonjour le monde',
      status: 'completed',
      updatedAt: '2026-11-18T00:00:00.000Z',
      usage: { inputTokens: 12, model: 'bonsai-2:2b', outputTokens: 34 },
    });
    expect(parsed.usage?.inputTokens).toBe(12);
  });

  it('allows null response and usage for failed calls', () => {
    const parsed = aiMessageSchema.parse({
      createdAt: '2026-11-18T00:00:00.000Z',
      deletedAt: null,
      id: '123e4567-e89b-42d3-a456-426655440000',
      model: 'bonsai-2:2b',
      provider: 'ollama',
      response: null,
      status: 'failed',
      updatedAt: '2026-11-18T00:00:00.000Z',
      usage: null,
    });
    expect(parsed.status).toBe('failed');
  });

  it('rejects unknown statuses', () => {
    expect(() =>
      aiMessageSchema.parse({
        createdAt: '2026-11-18T00:00:00.000Z',
        deletedAt: null,
        id: '123e4567-e89b-42d3-a456-426655440000',
        model: 'm',
        provider: 'ollama',
        response: null,
        status: 'exploded',
        updatedAt: '2026-11-18T00:00:00.000Z',
        usage: null,
      }),
    ).toThrow();
  });
});

describe('aiMessagePromptSchema', () => {
  it('parses a stored prompt', () => {
    const parsed = aiMessagePromptSchema.parse({
      createdAt: '2026-11-18T00:00:00.000Z',
      id: '123e4567-e89b-42d3-a456-426655440000',
      messageId: '223e4567-e89b-42d3-a456-426655440000',
      prompt: 'You are a professional translator.',
      role: 'system',
    });
    expect(parsed.role).toBe('system');
  });

  it('rejects roles longer than 10 characters', () => {
    expect(() =>
      aiMessagePromptSchema.parse({
        createdAt: '2026-11-18T00:00:00.000Z',
        id: '123e4567-e89b-42d3-a456-426655440000',
        messageId: '223e4567-e89b-42d3-a456-426655440000',
        prompt: 'p',
        role: 'x'.repeat(11),
      }),
    ).toThrow();
  });
});
