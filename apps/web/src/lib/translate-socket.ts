import { io, type Socket } from 'socket.io-client';
import type {
  WsTranslateAck,
  WsTranslationErrorEvent,
  WsTranslationEvent,
} from '@trainslator/shared';

/** Lazily-created shared socket; same-origin, cookie auth via the WS handshake. */
let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io({ withCredentials: true });
  }
  return socket;
}

interface TranslateResult {
  text: string;
  cached: boolean;
}

export interface TranslateCallbacks {
  onDone: (result: TranslateResult) => void;
  onError: (message: string) => void;
}

export interface TranslateAccept {
  requestId: string;
}

/**
 * Runs one translate request over the WebSocket channel.
 *
 * The server answers with an immediate ack. 200 carries the cached text;
 * 202 enqueues the job and the result arrives as a `translation` event.
 * 400/404/429/500 acks surface as constant errors. Nothing from the wire is
 * trusted beyond the parsed envelope.
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
    done({ text: event.text, cached: event.cached });
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
      { text, targetLanguage, requestId },
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
            done({ text: ack.data ?? '', cached: true });
            return;
          case 202:
            return; // the `translation` event will land later
          case 429:
            error(
              `Rate limit reached. Retry in ${Math.ceil((ack.retryAfterMs ?? 60_000) / 1000)}s.`,
            );
            return;
          case 400:
            error('The request was invalid.');
            return;
          case 404:
            error('That language is not supported.');
            return;
          default:
            error('The translation failed. Please try again.');
        }
      },
    );

  return { requestId };
}
