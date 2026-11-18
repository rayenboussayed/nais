import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { AllExceptionsFilter } from './all-exceptions.filter';

function makeHost() {
  const sent = vi.fn();
  const code = vi.fn().mockReturnValue({ send: sent });
  const host: ArgumentsHost = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ code }) }),
  } as unknown as ArgumentsHost;
  return { host, sent, code };
}

describe('AllExceptionsFilter', () => {
  it('does not touch the HTTP reply on a websocket context', () => {
    const code = vi.fn();
    const replySend = vi.fn();
    const host: ArgumentsHost = {
      getType: () => 'ws',
      switchToHttp: () => ({ getResponse: () => ({ code, send: replySend }) }),
    } as unknown as ArgumentsHost;

    expect(() => new AllExceptionsFilter().catch(new Error('boom'), host)).not.toThrow();
    expect(code).not.toHaveBeenCalled();
    expect(replySend).not.toHaveBeenCalled();

    expect(() => new AllExceptionsFilter().catch('plain string failure', host)).not.toThrow();
    expect(code).not.toHaveBeenCalled();
  });

  it('passes through Nest HTTP exceptions with status and message', () => {
    const { host, sent, code } = makeHost();
    new AllExceptionsFilter().catch(new NotFoundException('Translation not found'), host);
    expect(code).toHaveBeenCalledWith(404);
    expect(sent).toHaveBeenCalledWith({ statusCode: 404, message: 'Translation not found' });
  });

  it('accepts a raw string response body with its status', () => {
    const { host, sent, code } = makeHost();
    new AllExceptionsFilter().catch(new HttpException('teapot text', 418), host);
    expect(code).toHaveBeenCalledWith(418);
    expect(sent).toHaveBeenCalledWith({ statusCode: 418, message: 'teapot text' });
  });

  it('falls back to the exception message when the response object has no message', () => {
    const { host, sent } = makeHost();
    const exception = new HttpException({}, 400);
    new AllExceptionsFilter().catch(exception, host);
    expect(sent).toHaveBeenCalledWith({ statusCode: 400, message: exception.message });
  });

  it('keeps validation string arrays', () => {
    const { host, sent } = makeHost();
    new AllExceptionsFilter().catch(new BadRequestException(['a', 'b']), host);
    expect(sent).toHaveBeenCalledWith({ statusCode: 400, message: ['a', 'b'] });
  });

  it('answers 500 with a constant message and does not leak the error', () => {
    const { host, sent, code } = makeHost();
    const secret = new Error('pg connection string password=hunter2');
    new AllExceptionsFilter().catch(secret, host);
    expect(code).toHaveBeenCalledWith(500);
    expect(sent).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });

  it('does not leak when a non-Error is thrown', () => {
    const { host, sent } = makeHost();
    new AllExceptionsFilter().catch('weird string failure', host);
    expect(sent).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });
});
