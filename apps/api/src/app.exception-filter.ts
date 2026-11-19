import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ApiError } from '@trainslator/shared';
import type { FastifyReply } from 'fastify';

import { HttpException, HttpStatus, Logger } from '@nestjs/common';

/**
 * Maps every thrown value to the shared `ApiError` wire shape. Nest HTTP
 * exceptions keep their status and message; anything else answers 500 with a
 * constant message and is logged with its stack. Internal details never
 * leave the process in the response body.
 */
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Renders the constant error body. Only meaningful on HTTP hosts (the WS transport gets its own handling).
   * @param exception - any value thrown by a handler; may be non-Error
   * @param host - arguments host; must be an HTTP context (Fastify adapter)
   */
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

  private extractMessage(response: object | string, fallback: string): string | string[] {
    if (typeof response === 'string') return response;
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
    if (
      Array.isArray(message) &&
      message.every((part): part is string => typeof part === 'string')
    ) {
      return message;
    }
    return fallback;
  }

  private toBody(exception: unknown): ApiError {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      return {
        message: this.extractMessage(exception.getResponse(), exception.message),
        statusCode,
      };
    }

    // Never log the exception body or stack here: error messages can carry
    // connection strings. The 500 response is a constant by design.
    this.logger.error(exception instanceof Error ? exception.name : typeof exception);
    return {
      message: 'Internal server error',
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
