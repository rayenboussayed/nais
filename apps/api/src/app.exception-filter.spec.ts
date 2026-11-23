import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './app.exception-filter.js';

/**
 * Builds a minimal ArgumentsHost double for the HTTP reply path.
 * @returns the host double plus the captured reply object
 */
function makeHost() {
  const sent = vi.fn();
  const replyObj: {
    code: ReturnType<typeof vi.fn>;
    header: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  } = {
    code: vi.fn(),
    header: vi.fn(),
    send: sent,
  };
  replyObj.code.mockReturnValue(replyObj);
  replyObj.header.mockReturnValue(replyObj);
  const host: ArgumentsHost = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => replyObj }),
  } as unknown as ArgumentsHost;
  return { code: replyObj.code, header: replyObj.header, host, sent };
}

describe('AllExceptionsFilter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('attaches the realm header on 401s and only on 401s', () => {
    const filter = new AllExceptionsFilter();

    const unauthorized = makeHost();
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    filter.catch(new UnauthorizedException('Unauthorized'), unauthorized.host);
    expect(unauthorized.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Basic realm="trainslator"',
    );

    const notFound = makeHost();
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    filter.catch(new NotFoundException('nope'), notFound.host);
    expect(notFound.header).not.toHaveBeenCalled();
  });

  it('does not touch the HTTP reply on a websocket context', () => {
    const code = vi.fn();
    const replySend = vi.fn();
    const host: ArgumentsHost = {
      getType: () => 'ws',
      switchToHttp: () => ({ getResponse: () => ({ code, send: replySend }) }),
    } as unknown as ArgumentsHost;

    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    expect(() => new AllExceptionsFilter().catch(new Error('boom'), host)).not.toThrow();
    expect(code).not.toHaveBeenCalled();
    expect(replySend).not.toHaveBeenCalled();

    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    expect(() => new AllExceptionsFilter().catch('plain string failure', host)).not.toThrow();
    expect(code).not.toHaveBeenCalled();
  });

  it('passes through Nest HTTP exceptions with status and message', () => {
    const { code, host, sent } = makeHost();
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch(new NotFoundException('Translation not found'), host);
    expect(code).toHaveBeenCalledWith(404);
    expect(sent).toHaveBeenCalledWith({ message: 'Translation not found', statusCode: 404 });
  });

  it('accepts a raw string response body with its status', () => {
    const { code, host, sent } = makeHost();
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch(new HttpException('teapot text', 418), host);
    expect(code).toHaveBeenCalledWith(418);
    expect(sent).toHaveBeenCalledWith({ message: 'teapot text', statusCode: 418 });
  });

  it('falls back to the exception message when the response object has no message', () => {
    const { host, sent } = makeHost();
    const exception = new HttpException({}, 400);
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch(exception, host);
    expect(sent).toHaveBeenCalledWith({ message: exception.message, statusCode: 400 });
  });

  it('keeps validation string arrays', () => {
    const { host, sent } = makeHost();
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch(new BadRequestException(['a', 'b']), host);
    expect(sent).toHaveBeenCalledWith({ message: ['a', 'b'], statusCode: 400 });
  });

  it('answers 500 with a constant message and does not leak the error', () => {
    const { code, host, sent } = makeHost();
    const secret = new Error('pg connection string password=hunter2');
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch(secret, host);
    expect(code).toHaveBeenCalledWith(500);
    expect(sent).toHaveBeenCalledWith({ message: 'Internal server error', statusCode: 500 });
  });

  it('does not leak when a non-Error is thrown', () => {
    const { host, sent } = makeHost();
    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch('weird string failure', host);
    expect(sent).toHaveBeenCalledWith({ message: 'Internal server error', statusCode: 500 });
  });

  it('logs typeof as the message and the filter name as context on a non-HTTP context', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const host: ArgumentsHost = {
      getType: () => 'ws',
      switchToHttp: () => ({ getResponse: () => ({}) }),
    } as unknown as ArgumentsHost;

    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch('plain string failure', host);

    expect(log).toHaveBeenCalledWith('string', 'AllExceptionsFilter');
  });

  it('logs typeof for a non-Error HTTP exception with no extra context argument', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const { host } = makeHost();

    // eslint-disable-next-line promise/valid-params -- Nest ExceptionFilter.catch(error, host), not Promise#catch
    new AllExceptionsFilter().catch('weird string failure', host);

    expect(log).toHaveBeenCalledWith('string');
  });
});
