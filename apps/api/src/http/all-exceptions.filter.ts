import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import type { ApiError } from '@trainslator/shared';

/**
 * Maps every thrown value to the shared `ApiError` wire shape. Nest HTTP
 * exceptions keep their status and message; anything else answers 500 with a
 * constant message and is logged with its stack. Internal details never
 * leave the process in the response body.
 */
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * @param exception - any value thrown by a handler; may be non-Error
   * @param host - arguments host; must be an HTTP context (Fastify adapter)
   */
  /** Only meaningful on HTTP hosts (the WS transport gets its own handling). */
  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error(
        exception instanceof Error ? exception.name : typeof exception,
        AllExceptionsFilter.name,
      );
      return;
    }
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const body = this.toBody(exception);
    void reply.code(body.statusCode);
    // Browsers surface the basic-auth dialog from this header; API clients get a clean 401 either way.
    if (body.statusCode === 401) {
      void reply.header('WWW-Authenticate', 'Basic realm="trainslator"');
    }
    void reply.send(body);
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        statusCode,
        message: this.extractMessage(exception.getResponse(), exception.message),
      };
    }

    // Never log the exception body or stack here: error messages can carry
    // connection strings. The 500 response is a constant by design.
    this.logger.error(exception instanceof Error ? exception.name : typeof exception);
    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }

  private extractMessage(response: string | object, fallback: string): string | string[] {
    if (typeof response === 'string') return response;
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string' || Array.isArray(message)) {
      return message as string | string[];
    }
    return fallback;
  }
}
