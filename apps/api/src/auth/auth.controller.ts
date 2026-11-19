import type { LoginRequest } from '@trainslator/shared';
import type { FastifyReply } from 'fastify';

import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Ip,
  Logger,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loginRequestSchema } from '@trainslator/shared';

import type { Env } from '../config/env.js';

import { RateLimiter } from '../common/rate-limit.js';
import { SESSION_COOKIE_NAME, signSession } from './session.js';
import { DUMMY_SCRYPT_HASH, verifyScryptPassword } from './validator.js';

const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Session login/logout; both endpoints live behind the public allowlist. */
@Controller('auth')
export class AuthController {
  private readonly limiter = new RateLimiter(5, 60_000);
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  /**
   * POST `/api/auth/login`
   *
   * Constant 401 body for wrong credentials (never distinguishes username
   * from password). On success, sets the `trainslator_session` cookie:
   * HttpOnly, SameSite=Lax, Path=/, Max-Age=12h, plus Secure in production.
   * Rate-limited to 5 attempts per minute per client IP.
   * @param body - the login body (username + password)
   * @param ip - the client IP used for the rate limiter
   * @param reply - the Fastify reply used to set the cookie
   * @returns the authenticated username
   */
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body({ schema: loginRequestSchema }) body: LoginRequest,
    @Ip() ip: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ username: string }> {
    // The limiter sees every attempt, including misconfigured deployments, so
    // probing for the misconfiguration is indistinguishable from a wrong guess.
    if (!this.limiter.hit(ip)) {
      throw new HttpException(
        { message: 'Too many login attempts', statusCode: 429 },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Never sign a session with a forgeable key: fail closed loudly.
    const secret = this.config.get('SESSION_SECRET', { infer: true });
    if (!secret) {
      this.logger.error('login refused: SESSION_SECRET is not configured');
      throw new HttpException(
        { message: 'Service unavailable', statusCode: 500 },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const expectedUsername = this.config.get('BASIC_AUTH_USERNAME', { infer: true });
    const storedHash = this.config.get('BASIC_AUTH_PASSWORD_HASH', { infer: true });
    // Always run the KDF — against the configured hash or the dummy — so the
    // response time does not reveal whether the username exists.
    const passwordOk = await verifyScryptPassword(storedHash ?? DUMMY_SCRYPT_HASH, body.password);
    if (!storedHash || body.username !== expectedUsername || !passwordOk) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { maxAge, value } = signSession(body.username, secret, COOKIE_MAX_AGE_SECONDS * 1000);
    const secure = this.config.get('NODE_ENV', { infer: true }) === 'production' ? '; Secure' : '';
    reply.header(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`,
    );
    return { username: body.username };
  }

  /**
   * POST `/api/auth/logout` — clears the session cookie (Secure in production, matching login).
   * @param reply - the Fastify reply used to clear the cookie
   */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  logout(@Res({ passthrough: true }) reply: FastifyReply): void {
    const secure = this.config.get('NODE_ENV', { infer: true }) === 'production' ? '; Secure' : '';
    reply.header(
      'Set-Cookie',
      `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    );
  }
}
