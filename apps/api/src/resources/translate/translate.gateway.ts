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
import { importTimeEnv } from '../ai/pipeline-loader.js';
import { LanguagesService } from '../languages/languages.service.js';
import { TranslationsService } from '../translations/translations.service.js';

/**
 * Gateway options; import time constant derived from CORS_ORIGINS via the
 * narrow env reader (empty when unset, matching the previous default).
 */
export const gatewayOptions = buildGatewayOptions(importTimeEnv('CORS_ORIGINS'));

/** Cache lookup result produced by a pipeline peek strategy. */
type CacheOutcome =
  | { kind: 'catalogue-hit'; text: string }
  | { kind: 'dedicated-hit'; result: Record<string, unknown> }
  | { kind: 'miss' }
  | { kind: 'missing-language' };

type OutboundEvent = 'ai-error' | 'ai-result' | 'translation' | 'translation-error';

/** Discriminated outcome of the pipeline shared by both message handlers. */
type PipelineOutcome =
  | { kind: 'accepted' }
  | { kind: 'catalogue-hit'; text: string }
  | { kind: 'dedicated-hit'; result: Record<string, unknown> }
  | { kind: 'failed' }
  | { kind: 'invalid-input' }
  | { kind: 'missing-language' }
  | { kind: 'rate-limited' };

/** The validated translate-task input used for catalogue lookups. */
type TranslateInput = { targetLanguage: string; text: string };

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
    const outcome = await this.runPipeline({
      client,
      handlerName: 'ai handler failed',
      peek: (input) =>
        task === 'translate'
          ? this.peekCatalogue(
              (input as TranslateInput).targetLanguage,
              (input as TranslateInput).text,
            )
          : this.peekDedicated(task, input),
      requestId: message.requestId,
      task,
      validate: () => {
        // eslint-disable-next-line security/detect-object-injection -- task narrowed to AiTask by aiTaskSchema before this point
        const inputParse = aiRequestSchemas[task].safeParse(message.input);
        return inputParse.success ? (inputParse.data as Record<string, unknown>) : null;
      },
    });
    return ack(aiAckFor(outcome, message.requestId));
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
    const outcome = await this.runPipeline({
      client,
      handlerName: 'translate handler failed',
      peek: () => this.peekCatalogue(message.targetLanguage, message.text),
      requestId: message.requestId,
      task: 'translate',
      validate: () => ({ targetLanguage: message.targetLanguage, text: message.text }),
    });
    return ack(translateAckFor(outcome, message.requestId));
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

  /**
   * Resolves the target language and peeks the translation catalogue.
   * @param targetLanguage - the ISO-639-1 code carried by the request
   * @param text - the source text whose canonical key is looked up
   * @returns a catalogue hit, a miss, or a missing-language outcome
   */
  private async peekCatalogue(targetLanguage: string, text: string): Promise<CacheOutcome> {
    const language = await this.languages.findByIso(targetLanguage);
    if (!language) {
      return { kind: 'missing-language' };
    }
    const cached = await this.translations.findByLanguageAndKey(
      language.id,
      translationKeyFor(text),
    );
    return cached ? { kind: 'catalogue-hit', text: cached.text } : { kind: 'miss' };
  }

  /**
   * Peeks the AI result cache for a dedicated (non-translate) task.
   * @param task - the AI task whose cache is inspected
   * @param input - the validated task input
   * @returns a dedicated hit or a miss
   */
  private async peekDedicated(
    task: Exclude<AiTask, 'translate'>,
    input: Record<string, unknown>,
  ): Promise<CacheOutcome> {
    const peek = await this.ai.peekCache(task, input);
    return peek ? { kind: 'dedicated-hit', result: peek } : { kind: 'miss' };
  }

  /**
   * Runs the rate limit -> validation -> cache peek -> enqueue flow shared by
   * both message handlers; a failure is logged once with the caller's message.
   * @param request - normalized inputs and strategy callbacks for this message
   * @param request.client - the sending socket, used for identity and id
   * @param request.handlerName - log label identifying the calling handler
   * @param request.peek - strategy returning the cache lookup outcome
   * @param request.requestId - correlation id carried into the queued job
   * @param request.task - AI task used when enqueuing a cache miss
   * @param request.validate - per-task input validator returning null on failure
   * @returns a discriminated outcome the caller maps to its own ack shape
   */
  private async runPipeline(request: {
    client: Socket;
    handlerName: string;
    peek: (input: Record<string, unknown>) => Promise<CacheOutcome>;
    requestId: string;
    task: AiTask;
    validate: () => null | Record<string, unknown>;
  }): Promise<PipelineOutcome> {
    try {
      if (!this.limiter.hit(this.identityOf(request.client))) {
        return { kind: 'rate-limited' };
      }
      const input = request.validate();
      if (input === null) {
        return { kind: 'invalid-input' };
      }
      const peeked = await request.peek(input);
      if (peeked.kind === 'miss') {
        await this.enqueue(request.task, input, request.requestId, request.client.id);
        return { kind: 'accepted' };
      }
      return peeked;
    } catch (error) {
      this.logger.error(
        `${request.handlerName}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return { kind: 'failed' };
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps a shared pipeline outcome onto the `ai` message ack contract.
 * @param outcome - the outcome returned by the shared pipeline
 * @param requestId - the validated request correlation id
 * @returns the exact wire ack for this outcome
 */
function aiAckFor(outcome: PipelineOutcome, requestId: string): WsAiAck {
  switch (outcome.kind) {
    case 'accepted':
      return { cached: null, requestId, result: null, statusCode: 202 };
    case 'catalogue-hit':
      return {
        cached: true,
        requestId,
        result: { cached: true, text: outcome.text },
        statusCode: 200,
      };
    case 'dedicated-hit':
      return { cached: true, requestId, result: outcome.result, statusCode: 200 };
    case 'failed':
      return { cached: null, requestId, result: null, statusCode: 500 };
    case 'invalid-input':
      return { cached: null, requestId, result: null, statusCode: 400 };
    case 'missing-language':
      return { cached: null, requestId, result: null, statusCode: 404 };
    case 'rate-limited':
      return { cached: null, requestId, result: null, retryAfterMs: 60_000, statusCode: 429 };
  }
}

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

/**
 * Maps a shared pipeline outcome onto the legacy `translate` ack contract.
 * @param outcome - the outcome returned by the shared pipeline
 * @param requestId - the validated request correlation id
 * @returns the exact wire ack for this outcome
 */
function translateAckFor(outcome: PipelineOutcome, requestId: string): WsTranslateAck {
  switch (outcome.kind) {
    case 'accepted':
      return { data: null, requestId, statusCode: 202 };
    case 'catalogue-hit':
      return { data: outcome.text, requestId, statusCode: 200 };
    case 'failed':
      return { data: null, requestId, statusCode: 500 };
    case 'missing-language':
      return { data: null, requestId, statusCode: 404 };
    case 'rate-limited':
      return { data: null, requestId, retryAfterMs: 60_000, statusCode: 429 };
    default:
      // Unreachable for translate: its validate never fails and its peek is
      // catalogue-only. Both would be a 400 on the legacy contract.
      return { data: null, requestId, statusCode: 400 };
  }
}
