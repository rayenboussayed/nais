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
  WsTranslateAck,
  WsTranslationErrorEvent,
  WsTranslationEvent,
} from '@trainslator/shared';
import { wsTranslateMessageSchema, wsTranslateJobSchema } from '@trainslator/shared';
import { PgBossService } from '@wavezync/nestjs-pgboss';

import type { Env } from '../config/env';
import { authenticateHeaders, firstHeader } from '../auth/authenticate';
import { isOriginAllowed, parseAllowedOrigins, buildGatewayOptions } from '../auth/origin';
import { RateLimiter } from '../common/rate-limit';
import { translationKeyFor } from '../common/key';
import { LanguagesService } from '../languages/languages.service';
import { TranslationsService } from '../translations/translations.service';

/** The single translation queue. GPU-bound work is serialized with batchSize 1. */
export const TRANSLATE_QUEUE = 'translate';

/** Gateway options; import time constant derived from the environment. */
const gatewayOptions = buildGatewayOptions(process.env.CORS_ORIGINS);

/**
 * socket.io gateway for the async translation flow. Clients emit `translate`
 * and receive one of three answers: an immediate `ack` carrying the cached
 * text (200), an `ack` accepting the request (202; result arrives via the
 * `translation` event), or an `ack` signaling rate limiting (429).
 * Auth is enforced in the handshake middleware for every connection.
 */
@WebSocketGateway(gatewayOptions)
export class TranslateGateway implements OnGatewayInit {
  @WebSocketServer() private readonly server!: Server;

  private readonly limiter = new RateLimiter(10, 60_000);
  /** Global backstop: caps handshake attempts per minute regardless of credential. */
  private readonly connectLimiter = new RateLimiter(60, 60_000);
  private readonly logger = new Logger(TranslateGateway.name);

  constructor(
    private readonly translations: TranslationsService,
    private readonly languages: LanguagesService,
    private readonly pgBoss: PgBossService,
    private readonly config: ConfigService<Env, true>,
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
        if (!this.connectLimiter.hit('*')) {
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

  /** Emits an event to one connected client; used by the translation worker. */
  emitTo(
    socketId: string,
    event: 'translation' | 'translation-error',
    payload: WsTranslationEvent | WsTranslationErrorEvent,
  ): void {
    this.server.to(socketId).emit(event, payload);
  }

  /**
   * Handles a `translate` message: schema validation and unknown languages
   * are free; cache hit -> immediate answer; cache miss -> enqueued for the
   * pg-boss worker; over-limit -> 429. Any backend failure answers 500
   * (structured, never silently dropped).
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
      const language = await this.languages.findByIso(message.targetLanguage);
      if (!language) {
        return ack({ statusCode: 404, requestId: message.requestId, data: null });
      }

      // The handshake middleware always sets socket.data.username.
      const identity = client.data.username as string;
      if (!this.limiter.hit(identity)) {
        return ack({
          statusCode: 429,
          requestId: message.requestId,
          data: null,
          retryAfterMs: 60_000,
        });
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

      const job = wsTranslateJobSchema.parse({ ...message, socketId: client.id });
      // retryLimit 0: a poison job should fail, not call the model up to 3 times.
      await this.pgBoss.scheduleJob(TRANSLATE_QUEUE, job, { retryLimit: 0 });

      return ack({ statusCode: 202, requestId: message.requestId, data: null });
    } catch (error) {
      this.logger.error(`translate handler failed: ${String(error)}`);
      return ack({ statusCode: 500, requestId: message.requestId, data: null });
    }
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Pulls a valid uuid requestId out of a garbage payload, else null. */
function extractRequestId(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const candidate = (data as Record<string, unknown>).requestId;
  return typeof candidate === 'string' && UUID_RE.test(candidate) ? candidate : null;
}
