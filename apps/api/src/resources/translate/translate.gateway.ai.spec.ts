import type { WsAiAck } from '@trainslator/shared';
import type { Socket } from 'socket.io';

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TranslateGateway } from './translate.gateway.js';

/** Unit tests for the `ai` message handler and its ack contract. */

/**
 * Builds the gateway with stubbed dependencies for unit tests.
 * @param overrides - per-test dependency behaviour
 * @param overrides.cached - the catalogue row the cache peek should see
 * @param overrides.cached.text - the catalogue text a cache hit returns
 * @param overrides.language - the language the fixture resolves, or null to model a missing one
 * @param overrides.peek - the ai_cache entry the AI peek should see, or null for a miss
 * @returns the gateway and its dependency stubs
 */
function makeGateway(
  overrides: {
    cached?: { text: string };
    language?: null | { id: string };
    peek?: null | Record<string, unknown>;
  } = {},
) {
  const translations = {
    findByLanguageAndKey: vi.fn(async () => overrides.cached ?? null),
  };
  const languages = {
    findByIso: vi.fn(async () =>
      overrides.language === undefined
        ? { id: 'lang-1', iso6391: 'fr', name: 'French' }
        : overrides.language,
    ),
  };
  const pgBoss = { scheduleJob: vi.fn(async () => undefined) };
  const config = { get: () => undefined };
  const ai = { peekCache: vi.fn(async () => overrides.peek ?? null) };
  const gateway = new TranslateGateway(
    translations as never,
    languages as never,
    pgBoss as never,
    config as never,
    ai as never,
  );
  return { ai, gateway, languages, pgBoss, translations };
}

const socket = {
  data: { username: 'admin' },
  handshake: { address: '203.0.113.9', headers: {} },
  id: 'socket-1',
} as unknown as Socket;

/**
 * Collects every ack call for assertions.
 * @returns the collector and the collected ack calls
 */
function ackCollector() {
  const calls: WsAiAck[] = [];
  const ack = (response: WsAiAck) => {
    calls.push(response);
  };
  return { ack, calls };
}

describe('TranslateGateway ai handler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects a garbage payload with 400 and a null requestId', async () => {
    const { gateway } = makeGateway();
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(null, socket, ack);
    expect(calls).toEqual([{ cached: null, requestId: null, result: null, statusCode: 400 }]);
  });

  it('rejects invalid per-task input with 400 and keeps the requestId', async () => {
    const { gateway } = makeGateway();
    const { ack, calls } = ackCollector();
    const requestId = '123e4567-e89b-42d3-a456-426655440000';
    await gateway.onAiMessage({ input: { nope: true }, requestId, task: 'sentiment' }, socket, ack);
    expect(calls).toEqual([{ cached: null, requestId, result: null, statusCode: 400 }]);
  });

  it('answers 429 with retryAfterMs once the identity budget is exhausted', async () => {
    const { gateway } = makeGateway({ peek: null });
    const message = {
      input: { text: 'spam' },
      requestId: '123e4567-e89b-42d3-a456-426655440000',
      task: 'sentiment',
    };
    for (let i = 0; i < 10; i += 1) {
      await gateway.onAiMessage(message, socket, () => {});
    }
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(message, socket, ack);
    expect(calls).toEqual([
      {
        cached: null,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        result: null,
        retryAfterMs: 60_000,
        statusCode: 429,
      },
    ]);
  });

  it('answers 404 for an unsupported target language on the translate task', async () => {
    const { gateway } = makeGateway({ language: null });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        input: { targetLanguage: 'zz', text: 'hello' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'translate',
      },
      socket,
      ack,
    );
    expect(calls).toEqual([
      {
        cached: null,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        result: null,
        statusCode: 404,
      },
    ]);
  });

  it('answers 200 with the catalogue text inline on a translate cache hit', async () => {
    const { gateway } = makeGateway({ cached: { text: 'bonjour' } });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        input: { targetLanguage: 'fr', text: 'hello' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'translate',
      },
      socket,
      ack,
    );
    expect(calls).toEqual([
      {
        cached: true,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        result: { cached: true, text: 'bonjour' },
        statusCode: 200,
      },
    ]);
  });

  it('answers 200 with the cached task result inline on a dedicated-task cache hit', async () => {
    const peek = { cached: true, label: 'POSITIVE', score: 0.9 };
    const { ai, gateway } = makeGateway({ peek });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        input: { text: 'I love this' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'sentiment',
      },
      socket,
      ack,
    );
    expect(ai.peekCache).toHaveBeenCalledWith('sentiment', { text: 'I love this' });
    expect(calls).toEqual([
      {
        cached: true,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        result: peek,
        statusCode: 200,
      },
    ]);
  });

  it('answers 202 and enqueues to the ai-task queue on a cache miss', async () => {
    const { gateway, pgBoss } = makeGateway({ peek: null });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        input: { text: 'miss me' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'sentiment',
      },
      socket,
      ack,
    );
    expect(pgBoss.scheduleJob).toHaveBeenCalledWith(
      'ai-task',
      expect.objectContaining({
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'sentiment',
      }),
      { retryLimit: 0 },
    );
    expect(calls).toEqual([
      {
        cached: null,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        result: null,
        statusCode: 202,
      },
    ]);
  });

  it('answers 500 (not a hang) when the backend throws', async () => {
    const { gateway, languages } = makeGateway({ peek: null });
    languages.findByIso.mockRejectedValueOnce(new Error('db on fire'));
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        input: { targetLanguage: 'fr', text: 'hello' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        task: 'translate',
      },
      socket,
      ack,
    );
    expect(calls).toEqual([
      {
        cached: null,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        result: null,
        statusCode: 500,
      },
    ]);
    expect(log).toHaveBeenCalledWith('ai handler failed: Error');
  });
});
