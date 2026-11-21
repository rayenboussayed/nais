// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WsTranslateAck } from './types';

const state = {
  ackError: null as Error | null,
  ackPayload: undefined as undefined | WsTranslateAck,
};

const emitted: Array<{ data: unknown; event: string }> = [];
const listeners = new Map<string, Set<(payload: never) => void>>();

vi.mock('socket.io-client', () => {
  const socket = {
    emit: (
      event: string,
      data: unknown,
      ack?: (error: Error | null, response?: WsTranslateAck) => void,
    ) => {
      emitted.push({ data, event });
      if (ack) {
        queueMicrotask(() => ack(state.ackError, state.ackPayload));
      }
      return socket;
    },
    off: (event: string, handler: (payload: never) => void) => {
      listeners.get(event)?.delete(handler);
      return socket;
    },
    on: (event: string, handler: (payload: never) => void) => {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(handler);
      listeners.set(event, bucket);
      return socket;
    },
    timeout: () => socket,
  };
  return {
    default: { io: () => socket },
    io: () => socket,
  };
});

import { translateText } from './translate-socket';

/**
 * Dispatches a server event to its registered listeners.
 * @param event - the event name
 * @param payload - the event payload
 */
function emitServerEvent(event: string, payload: unknown) {
  for (const handler of listeners.get(event) ?? []) {
    handler(payload as never);
  }
}

const requestId = '123e4567-e89b-42d3-a456-426655440000';

describe('translateText', () => {
  beforeEach(() => {
    emitted.length = 0;
    listeners.clear();
    state.ackPayload = undefined;
    state.ackError = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the request with a uuid and completes on a 200 ack', async () => {
    state.ackPayload = { data: 'bonjour', requestId, statusCode: 200 };
    const done = vi.fn();
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: done, onError: error });
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith({ cached: true, text: 'bonjour' }));

    expect(emitted[0]?.data).toMatchObject({ targetLanguage: 'fr', text: 'hello' });
    expect(emitted[0]?.data).toMatchObject({ requestId: expect.any(String) });
  });

  it('queues on 202 and completes on the translation event', async () => {
    state.ackPayload = { data: null, requestId, statusCode: 202 };
    const done = vi.fn();
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: done, onError: error });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    const emittedRequestId = (emitted[0]?.data as { requestId: string }).requestId;

    emitServerEvent('translation', { cached: false, requestId: emittedRequestId, text: 'bonjour' });

    expect(done).toHaveBeenCalledWith({ cached: false, text: 'bonjour' });
    expect(error).not.toHaveBeenCalled();
  });

  it('ignores translation events for other requestIds', async () => {
    state.ackPayload = { data: null, requestId, statusCode: 202 };
    const done = vi.fn();

    translateText('hello', 'fr', { onDone: done, onError: vi.fn() });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    emitServerEvent('translation', {
      cached: false,
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      text: 'x',
    });
    expect(done).not.toHaveBeenCalled();
  });

  it('reports the server error event', async () => {
    state.ackPayload = { data: null, requestId, statusCode: 202 };
    const done = vi.fn();
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: done, onError: error });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));
    const emittedRequestId = (emitted[0]?.data as { requestId: string }).requestId;

    emitServerEvent('translation-error', { message: 'boom', requestId: emittedRequestId });
    expect(error).toHaveBeenCalledWith('The translation failed. Please try again.');
    expect(done).not.toHaveBeenCalled();
  });

  it('ignores translation-error events for other requestIds', async () => {
    state.ackPayload = { data: null, requestId, statusCode: 202 };
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: vi.fn(), onError: error });
    await vi.waitFor(() => expect(emitted).toHaveLength(1));

    emitServerEvent('translation-error', {
      message: 'boom',
      requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(error).not.toHaveBeenCalled();
  });

  it('maps a 429 ack to a retry message with the provided delay', async () => {
    state.ackPayload = { data: null, requestId, retryAfterMs: 30_000, statusCode: 429 };
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: vi.fn(), onError: error });
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('Rate limit reached. Retry in 30s.'));
  });

  it('maps 400, 404 and 500 acks to constant messages', async () => {
    for (const [statusCode, expected] of [
      [400, 'The request was invalid.'],
      [404, 'That language is not supported.'],
      [500, 'The translation failed. Please try again.'],
    ] as const) {
      const error = vi.fn();
      state.ackPayload = { data: null, requestId, statusCode };
      translateText('hello', 'fr', { onDone: vi.fn(), onError: error });
      await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expected));
    }
  });

  it('applies the default 60s retry hint on a 429 without one', async () => {
    const error429 = vi.fn();
    state.ackPayload = { data: null, requestId, statusCode: 429 };
    translateText('hello', 'fr', { onDone: vi.fn(), onError: error429 });
    await vi.waitFor(() =>
      expect(error429).toHaveBeenCalledWith('Rate limit reached. Retry in 60s.'),
    );
  });

  it('treats a 200 ack with null data as a protocol violation, not an empty answer', async () => {
    const error = vi.fn();
    const done = vi.fn();
    state.ackPayload = { data: null, requestId, statusCode: 200 };
    translateText('hello', 'fr', { onDone: done, onError: error });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('No answer from the translation service.'),
    );
    expect(done).not.toHaveBeenCalled();
  });

  it('reports a missing acknowledgment', async () => {
    state.ackPayload = undefined;
    const error = vi.fn();
    translateText('hello', 'fr', { onDone: vi.fn(), onError: error });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('No answer from the translation service.'),
    );
  });

  it('reports an unreachable service when the ack errors', async () => {
    state.ackError = new Error('timeout');
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: vi.fn(), onError: error });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith('Could not reach the translation service.'),
    );
  });

  it('fails with a timeout message when no terminal event arrives', async () => {
    vi.useFakeTimers();
    state.ackPayload = { data: null, requestId, statusCode: 202 };
    const error = vi.fn();

    translateText('hello', 'fr', { onDone: vi.fn(), onError: error });
    // let the queued ack callback run
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(45_000);

    expect(error).toHaveBeenCalledWith('The translation timed out. Please try again.');
  });
});
