import type { OnGatewayInit } from '@nestjs/websockets';
import type {
  AiTask,
  AiTaskJob,
  WsAiAck,
  WsAiErrorEvent,
  WsAiResultEvent,
  WsTranslateAck,
  WsTranslationErrorEvent,
  WsTranslationEvent,
} from '@trainslator/shared';
import type { Server, Socket } from 'socket.io';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Ack,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  aiRequestSchemas,
  aiTaskJobSchema,
  wsAiMessageSchema,
  wsTranslateMessageSchema,
} from '@trainslator/shared';
import { PgBossService } from '@wavezync/nestjs-pgboss';

import type { Env } from '../../environment.js';

import { AI_TASK_QUEUE } from '../../constants/ai-task.js';
import { authenticateHeaders, firstHeader } from '../../modules/auth/authenticate.js';
import {
  buildGatewayOptions,
  isOriginAllowed,
  parseAllowedOrigins,
} from '../../modules/auth/origin.js';
import { translationKeyFor } from '../../utils/key.js';
import { RateLimiter } from '../../utils/rate-limit.js';
import { AiService } from '../ai/ai.service.js';
import { LanguagesService } from '../languages/languages.service.js';
import { TranslationsService } from '../translations/translations.service.js';

/** Gateway options; import time constant derived from the environment. */
const gatewayOptions = buildGatewayOptions(process.env.CORS_ORIGINS);

type OutboundEvent = 'ai-error' | 'ai-result' | 'translation' | 'translation-error';

/**
 * socket.io gateway for the async AI flow. Clients emit `translate` (legacy,
 * catalogue-backed; unchanged contract) or `ai` (task + input) and receive an
 * immediate `ack`: cached inline (200), accepted for the queue (202, result
 * arrives via the `translation` / `ai-result` event), 400 invalid message,
 * 404 unknown language/task, 429 rate limited, or 500 on backend failure.
 * Auth is enforced in the handshake middleware for every connection.
 */
@WebSocketGateway(gatewayOptions)
export class TranslateGateway implements OnGatewayInit {
  /** Per-IP backstop: caps handshake attempts per minute regardless of credential. */
  private readonly connectLimiter = new RateLimiter(60, 60_000);

  private readonly limiter = new RateLimiter(10, 60_000);
  private readonly logger = new Logger(TranslateGateway.name);
  @WebSocketServer() private readonly server!: Server;

  constructor(
    private readonly translations: TranslationsService,
    private readonly languages: LanguagesService,
    private readonly pgBoss: PgBossService,
    private readonly config: ConfigService<Env, true>,
    private readonly ai: AiService,
  ) {}

  /**
   * Installs the handshake middleware: browser origins must be same-origin or
   * allowlisted (SameSite=Lax does not protect WebSockets); unauthenticated
   * clients are rejected before any frame is processed.
   * @param server - the socket.io server to attach the handshake middleware to
   */
  afterInit(server: Server): void {
    const extraOrigins = parseAllowedOrigins(this.config.get('CORS_ORIGINS', { infer: true }));
    server.use((socket, next) => {
      void (async () => {
        // Per-IP bucket when the peer is known; the union falls back to a
        // process-wide bucket so an address-less transport cannot flood freely.
        const address =
          typeof socket.handshake.address === 'string' && socket.handshake.address
            ? socket.handshake.address
            : '*';
        if (!this.connectLimiter.hit(address)) {
          next(new Error('too many connections'));
          return;
        }

        const headers = socket.handshake.headers as Record<string, string | string[] | undefined>;

        const origin = firstHeader(headers['origin']);
        const host = firstHeader(headers['host']);
        if (!isOriginAllowed(origin, host, extraOrigins)) {
          next(new Error('forbidden origin'));
          return;
        }

        const auth = await authenticateHeaders(headers, this.config);
        if (!auth) {
          next(new Error('unauthorized'));
          return;
        }
        socket.data.username = auth.username;
        next();
        // eslint-disable-next-line promise/no-callback-in-promise -- socket.io middleware: next() is the handshake callback, not a promise convention
      })().catch(() => next(new Error('unauthorized')));
    });
  }

  /**
   * Emits an event to one connected client; used by the ai-task worker.
   * @param socketId - the target socket id assigned by socket.io
   * @param event - the outbound event name
   * @param payload - the event payload
   */
  emitTo(
    socketId: string,
    event: OutboundEvent,
    payload: WsAiErrorEvent | WsAiResultEvent | WsTranslationErrorEvent | WsTranslationEvent,
  ): void {
    this.server.to(socketId).emit(event, payload);
  }

  /**
   * Handles an `ai` message: `{ task, input, requestId }`. The task's input
   * schema applies; cache hits answer inline with the result (200), misses go
   * to the shared `ai-task` queue and are delivered as `ai-result`.
   * @param data - the raw message body (validated before use)
   * @param client - the sending socket
   * @param ack - the acknowledgement callback to invoke with the result envelope
   * @returns nothing; resolves once the ack or the queue handoff has happened
   */
  @SubscribeMessage('ai')
  async onAiMessage(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: Socket,
    @Ack() ack: (response: WsAiAck) => Promise<void> | void,
  ): Promise<void> {
    const parsed = wsAiMessageSchema.safeParse(data);
    if (!parsed.success) {
      return ack({ cached: null, requestId: null, result: null, statusCode: 400 });
    }
    const message = parsed.data;
    const task = message.task;
    try {
      const identity = this.identityOf(client);
      if (!this.limiter.hit(identity)) {
        return ack({
          cached: null,
          requestId: message.requestId,
          result: null,
          retryAfterMs: 60_000,
          statusCode: 429,
        });
      }

      // Per-task input validation; translate also needs the catalogue peek.
      // eslint-disable-next-line security/detect-object-injection -- task narrowed to AiTask by aiTaskSchema before this point
      const inputParse = aiRequestSchemas[task].safeParse(message.input);
      if (!inputParse.success) {
        return ack({
          cached: null,
          requestId: message.requestId,
          result: null,
          statusCode: 400,
        });
      }
      const input = inputParse.data as Record<string, unknown>;

      if (task === 'translate') {
        const translateInput = input as { targetLanguage: string; text: string };
        const language = await this.languages.findByIso(translateInput.targetLanguage);
        if (!language) {
          return ack({
            cached: null,
            requestId: message.requestId,
            result: null,
            statusCode: 404,
          });
        }
        const cached = await this.translations.findByLanguageAndKey(
          language.id,
          translationKeyFor(translateInput.text),
        );
        if (cached) {
          return ack({
            cached: true,
            requestId: message.requestId,
            result: { cached: true, text: cached.text },
            statusCode: 200,
          });
        }
      } else {
        const peek = await this.ai.peekCache(task, input);
        if (peek) {
          return ack({
            cached: true,
            requestId: message.requestId,
            result: peek,
            statusCode: 200,
          });
        }
      }

      await this.enqueue(task, input, message.requestId, client.id);

      return ack({
        cached: null,
        requestId: message.requestId,
        result: null,
        statusCode: 202,
      });
    } catch (error) {
      this.logger.error(
        `ai handler failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return ack({
        cached: null,
        requestId: message.requestId,
        result: null,
        statusCode: 500,
      });
    }
  }

  /**
   * Handles a `translate` message with the legacy acknowledgement contract.
   * Validation is free; every accepted frame costs one token.
   * @param data - the raw message body (validated before use)
   * @param client - the sending socket
   * @param ack - the acknowledgement callback to invoke with the result envelope
   * @returns nothing; resolves once the ack or the queue handoff has happened
   */
  @SubscribeMessage('translate')
  async translate(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: Socket,
    @Ack() ack: (response: WsTranslateAck) => Promise<void> | void,
  ): Promise<void> {
    const parsed = wsTranslateMessageSchema.safeParse(data);
    if (!parsed.success) {
      return ack({ data: null, requestId: extractRequestId(data), statusCode: 400 });
    }
    const message = parsed.data;
    try {
      const identity = this.identityOf(client);
      if (!this.limiter.hit(identity)) {
        return ack({
          data: null,
          requestId: message.requestId,
          retryAfterMs: 60_000,
          statusCode: 429,
        });
      }

      const language = await this.languages.findByIso(message.targetLanguage);
      if (!language) {
        return ack({ data: null, requestId: message.requestId, statusCode: 404 });
      }

      const cached = await this.translations.findByLanguageAndKey(
        language.id,
        translationKeyFor(message.text),
      );
      if (cached) {
        return ack({
          data: cached.text,
          requestId: message.requestId,
          statusCode: 200,
        });
      }

      await this.enqueue(
        'translate',
        { targetLanguage: message.targetLanguage, text: message.text },
        message.requestId,
        client.id,
      );

      return ack({ data: null, requestId: message.requestId, statusCode: 202 });
    } catch (error) {
      this.logger.error(
        `translate handler failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return ack({ data: null, requestId: message.requestId, statusCode: 500 });
    }
  }

  private async enqueue(
    task: AiTask,
    input: Record<string, unknown>,
    requestId: string,
    socketId: string,
  ): Promise<void> {
    const job: AiTaskJob = aiTaskJobSchema.parse({ input, requestId, socketId, task });
    // retryLimit 0: a poison job should fail, not call the model up to 3 times.
    await this.pgBoss.scheduleJob(AI_TASK_QUEUE, job, { retryLimit: 0 });
  }

  /**
   * The handshake middleware always sets socket.data.username.
   * @param client - the connected socket
   * @returns the username captured at handshake time
   */
  private identityOf(client: Socket): string {
    return client.data.username as string;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pulls a valid uuid requestId out of a garbage payload, else null.
 * @param data - the raw message body of any shape
 * @returns the requestId when it is a valid uuid, else null
 */
function extractRequestId(data: unknown): null | string {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = (data as Record<string, unknown>).requestId;
  return typeof candidate === 'string' && UUID_RE.test(candidate) ? candidate : null;
}
