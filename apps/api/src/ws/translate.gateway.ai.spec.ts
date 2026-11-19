import { describe, expect, it, vi } from 'vitest';

import type { Socket } from 'socket.io';

import type { WsAiAck } from '@trainslator/shared';

import { TranslateGateway } from './translate.gateway';

/** Unit tests for the `ai` message handler and its ack contract. */

function makeGateway(
  overrides: {
    cached?: { text: string };
    language?: { id: string } | null;
    peek?: Record<string, unknown> | null;
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
  return { gateway, translations, languages, pgBoss, ai };
}

const socket = {
  data: { username: 'admin' },
  id: 'socket-1',
  handshake: { headers: {}, address: '203.0.113.9' },
} as unknown as Socket;

function ackCollector() {
  const calls: WsAiAck[] = [];
  const ack = (response: WsAiAck) => {
    calls.push(response);
  };
  return { ack, calls };
}

describe('TranslateGateway ai handler', () => {
  it('rejects a garbage payload with 400 and a null requestId', async () => {
    const { gateway } = makeGateway();
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(null, socket, ack);
    expect(calls).toEqual([{ statusCode: 400, requestId: null, cached: null, result: null }]);
  });

  it('rejects invalid per-task input with 400 and keeps the requestId', async () => {
    const { gateway } = makeGateway();
    const { ack, calls } = ackCollector();
    const requestId = '123e4567-e89b-42d3-a456-426655440000';
    await gateway.onAiMessage({ task: 'sentiment', input: { nope: true }, requestId }, socket, ack);
    expect(calls).toEqual([{ statusCode: 400, requestId, cached: null, result: null }]);
  });

  it('answers 404 for an unsupported target language on the translate task', async () => {
    const { gateway } = makeGateway({ language: null });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        task: 'translate',
        input: { text: 'hello', targetLanguage: 'zz' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      },
      socket,
      ack,
    );
    expect(calls).toEqual([
      {
        statusCode: 404,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        cached: null,
        result: null,
      },
    ]);
  });

  it('answers 200 with the catalogue text inline on a translate cache hit', async () => {
    const { gateway } = makeGateway({ cached: { text: 'bonjour' } });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        task: 'translate',
        input: { text: 'hello', targetLanguage: 'fr' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      },
      socket,
      ack,
    );
    expect(calls).toEqual([
      {
        statusCode: 200,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        cached: true,
        result: { text: 'bonjour', cached: true },
      },
    ]);
  });

  it('answers 200 with the cached task result inline on a dedicated-task cache hit', async () => {
    const peek = { label: 'POSITIVE', score: 0.9, cached: true };
    const { gateway, ai } = makeGateway({ peek });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        task: 'sentiment',
        input: { text: 'I love this' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      },
      socket,
      ack,
    );
    expect(ai.peekCache).toHaveBeenCalledWith('sentiment', { text: 'I love this' });
    expect(calls).toEqual([
      {
        statusCode: 200,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        cached: true,
        result: peek,
      },
    ]);
  });

  it('answers 202 and enqueues to the ai-task queue on a cache miss', async () => {
    const { gateway, pgBoss } = makeGateway({ peek: null });
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        task: 'sentiment',
        input: { text: 'miss me' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      },
      socket,
      ack,
    );
    expect(pgBoss.scheduleJob).toHaveBeenCalledWith(
      'ai-task',
      expect.objectContaining({
        task: 'sentiment',
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      }),
      { retryLimit: 0 },
    );
    expect(calls).toEqual([
      {
        statusCode: 202,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        cached: null,
        result: null,
      },
    ]);
  });

  it('answers 500 (not a hang) when the backend throws', async () => {
    const { gateway, languages } = makeGateway({ peek: null });
    languages.findByIso.mockRejectedValueOnce(new Error('db on fire'));
    const { ack, calls } = ackCollector();
    await gateway.onAiMessage(
      {
        task: 'translate',
        input: { text: 'hello', targetLanguage: 'fr' },
        requestId: '123e4567-e89b-42d3-a456-426655440000',
      },
      socket,
      ack,
    );
    expect(calls).toEqual([
      {
        statusCode: 500,
        requestId: '123e4567-e89b-42d3-a456-426655440000',
        cached: null,
        result: null,
      },
    ]);
  });
});
