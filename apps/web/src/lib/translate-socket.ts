import type {
  WsTranslateAck,
  WsTranslateMessage,
  WsTranslationErrorEvent,
  WsTranslationEvent,
} from '@trainslator/shared';

import { io, type Socket } from 'socket.io-client';

/** Lazily-created shared socket; same-origin, cookie auth via the WS handshake. */
let socket: null | Socket = null;

export type TranslateAccept = Pick<WsTranslateMessage, 'requestId'>;

export interface TranslateCallbacks {
  onDone: (result: TranslateResult) => void;
  onError: (message: string) => void;
}

type TranslateResult = Pick<WsTranslationEvent, 'cached' | 'text'>;

/**
 * Runs one translate request over the WebSocket channel.
 *
 * The server answers with an immediate ack. 200 carries the cached text;
 * 202 enqueues the job and the result arrives as a `translation` event.
 * 400/404/429/500 acks surface as constant errors. Nothing from the wire is
 * trusted beyond the parsed envelope.
 * @param text - the source text
 * @param targetLanguage - the iso639-1 target language
 * @param callbacks - the done/error handlers
 * @returns the request id to correlate the ack with the result event
 */
export function translateText(
  text: string,
  targetLanguage: string,
  callbacks: TranslateCallbacks,
): TranslateAccept {
  const requestId = crypto.randomUUID();
  const client = getSocket();

  const cleanup = () => {
    client.off('translation', onTranslation);
    client.off('translation-error', onTranslationError);
  };

  const done = (result: TranslateResult) => {
    clearTimeout(watchdog);
    cleanup();
    callbacks.onDone(result);
  };

  const error = (message: string) => {
    clearTimeout(watchdog);
    cleanup();
    callbacks.onError(message);
  };

  const watchdog = setTimeout(() => {
    error('The translation timed out. Please try again.');
  }, 45_000);

  const onTranslation = (event: WsTranslationEvent) => {
    if (event.requestId !== requestId) return;
    done({ cached: event.cached, text: event.text });
  };

  const onTranslationError = (event: WsTranslationErrorEvent) => {
    if (event.requestId !== requestId) return;
    error('The translation failed. Please try again.');
  };

  client.on('translation', onTranslation);
  client.on('translation-error', onTranslationError);

  client
    .timeout(10_000)
    .emit(
      'translate',
      { requestId, targetLanguage, text },
      (emitError: Error | null, ack?: WsTranslateAck) => {
        if (emitError) {
          error('Could not reach the translation service.');
          return;
        }
        if (!ack) {
          error('No answer from the translation service.');
          return;
        }
        switch (ack.statusCode) {
          case 200:
            if (ack.data === null) {
              // A cached answer without text is a protocol violation, not an answer.
              error('No answer from the translation service.');
              return;
            }
            done({ cached: true, text: ack.data });
            return;
          case 202:
            return; // the `translation` event will land later
          case 400:
            error('The request was invalid.');
            return;
          case 404:
            error('That language is not supported.');
            return;
          case 429:
            error(
              `Rate limit reached. Retry in ${Math.ceil((ack.retryAfterMs ?? 60_000) / 1000)}s.`,
            );
            return;
          default:
            error('The translation failed. Please try again.');
        }
      },
    );

  return { requestId };
}

/**
 * Returns the lazily-created shared socket.
 * @returns the shared socket
 */
function getSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true });
  }
  return socket;
}
