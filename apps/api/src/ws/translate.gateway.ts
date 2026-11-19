import {
  Ack,
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OnGatewayInit } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Server, Socket } from 'socket.io';

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
import {
  aiTaskJobSchema,
  aiRequestSchemas,
  wsAiMessageSchema,
  wsTranslateMessageSchema,
} from '@trainslator/shared';
import { PgBossService } from '@wavezync/nestjs-pgboss';

import type { Env } from '../config/env';
import { authenticateHeaders, firstHeader } from '../auth/authenticate';
import { isOriginAllowed, parseAllowedOrigins, buildGatewayOptions } from '../auth/origin';
import { RateLimiter } from '../common/rate-limit';
import { translationKeyFor } from '../common/key';
import { AiService } from '../ai/ai.service';
import { LanguagesService } from '../languages/languages.service';
import { TranslationsService } from '../translations/translations.service';
import { AI_TASK_QUEUE } from '../queue/ai-task-queue.constants';

/** Gateway options; import time constant derived from the environment. */
const gatewayOptions = buildGatewayOptions(process.env.CORS_ORIGINS);

type OutboundEvent = 'translation' | 'translation-error' | 'ai-result' | 'ai-error';

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
  @WebSocketServer() private readonly server!: Server;

  private readonly limiter = new RateLimiter(10, 60_000);
  /** Per-IP backstop: caps handshake attempts per minute regardless of credential. */
  private readonly connectLimiter = new RateLimiter(60, 60_000);
  private readonly logger = new Logger(TranslateGateway.name);

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
      })().catch(() => next(new Error('unauthorized')));
    });
  }

  /** Emits an event to one connected client; used by the ai-task worker. */
  emitTo(
    socketId: string,
    event: OutboundEvent,
    payload: WsTranslationEvent | WsTranslationErrorEvent | WsAiResultEvent | WsAiErrorEvent,
  ): void {
    this.server.to(socketId).emit(event, payload);
  }

  /**
   * Handles a `translate` message with the legacy acknowledgement contract.
   * Validation is free; every accepted frame costs one token.
   */
  @SubscribeMessage('translate')
  async translate(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: Socket,
    @Ack() ack: (response: WsTranslateAck) => Promise<void> | void,
  ): Promise<void> {
    const parsed = wsTranslateMessageSchema.safeParse(data);
    if (!parsed.success) {
      return ack({ statusCode: 400, requestId: extractRequestId(data), data: null });
    }
    const message = parsed.data;
    try {
      const identity = this.identityOf(client);
      if (!this.limiter.hit(identity)) {
        return ack({
          statusCode: 429,
          requestId: message.requestId,
          data: null,
          retryAfterMs: 60_000,
        });
      }

      const language = await this.languages.findByIso(message.targetLanguage);
      if (!language) {
        return ack({ statusCode: 404, requestId: message.requestId, data: null });
      }

      const cached = await this.translations.findByLanguageAndKey(
        language.id,
        translationKeyFor(message.text),
      );
      if (cached) {
        return ack({
          statusCode: 200,
          requestId: message.requestId,
          data: cached.text,
        });
      }

      await this.enqueue(
        'translate',
        { text: message.text, targetLanguage: message.targetLanguage },
        message.requestId,
        client.id,
      );

      return ack({ statusCode: 202, requestId: message.requestId, data: null });
    } catch (error) {
      this.logger.error(
        `translate handler failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return ack({ statusCode: 500, requestId: message.requestId, data: null });
    }
  }

  /**
   * Handles an `ai` message: `{ task, input, requestId }`. The task's input
   * schema applies; cache hits answer inline with the result (200), misses go
   * to the shared `ai-task` queue and are delivered as `ai-result`.
   */
  @SubscribeMessage('ai')
  async onAiMessage(
    @MessageBody() data: unknown,
    @ConnectedSocket() client: Socket,
    @Ack() ack: (response: WsAiAck) => Promise<void> | void,
  ): Promise<void> {
    const parsed = wsAiMessageSchema.safeParse(data);
    if (!parsed.success) {
      return ack({ statusCode: 400, requestId: null, cached: null, result: null });
    }
    const message = parsed.data;
    const task = message.task;
    try {
      const identity = this.identityOf(client);
      if (!this.limiter.hit(identity)) {
        return ack({
          statusCode: 429,
          requestId: message.requestId,
          cached: null,
          result: null,
          retryAfterMs: 60_000,
        });
      }

      // Per-task input validation; translate also needs the catalogue peek.
      const inputParse = aiRequestSchemas[task].safeParse(message.input);
      if (!inputParse.success) {
        return ack({
          statusCode: 400,
          requestId: message.requestId,
          cached: null,
          result: null,
        });
      }
      const input = inputParse.data as Record<string, unknown>;

      if (task === 'translate') {
        const translateInput = input as { text: string; targetLanguage: string };
        const language = await this.languages.findByIso(translateInput.targetLanguage);
        if (!language) {
          return ack({
            statusCode: 404,
            requestId: message.requestId,
            cached: null,
            result: null,
          });
        }
        const cached = await this.translations.findByLanguageAndKey(
          language.id,
          translationKeyFor(translateInput.text),
        );
        if (cached) {
          return ack({
            statusCode: 200,
            requestId: message.requestId,
            cached: true,
            result: { text: cached.text, cached: true },
          });
        }
      } else {
        const peek = await this.ai.peekCache(task, input);
        if (peek) {
          return ack({
            statusCode: 200,
            requestId: message.requestId,
            cached: true,
            result: peek,
          });
        }
      }

      await this.enqueue(task, input, message.requestId, client.id);

      return ack({
        statusCode: 202,
        requestId: message.requestId,
        cached: null,
        result: null,
      });
    } catch (error) {
      this.logger.error(
        `ai handler failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return ack({
        statusCode: 500,
        requestId: message.requestId,
        cached: null,
        result: null,
      });
    }
  }

  /** The handshake middleware always sets socket.data.username. */
  private identityOf(client: Socket): string {
    return client.data.username as string;
  }

  private async enqueue(
    task: AiTask,
    input: Record<string, unknown>,
    requestId: string,
    socketId: string,
  ): Promise<void> {
    const job: AiTaskJob = aiTaskJobSchema.parse({ task, input, requestId, socketId });
    // retryLimit 0: a poison job should fail, not call the model up to 3 times.
    await this.pgBoss.scheduleJob(AI_TASK_QUEUE, job, { retryLimit: 0 });
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Pulls a valid uuid requestId out of a garbage payload, else null. */
function extractRequestId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = (data as Record<string, unknown>).requestId;
  return typeof candidate === 'string' && UUID_RE.test(candidate) ? candidate : null;
}
