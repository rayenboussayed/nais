import type { ConfigService } from '@nestjs/config';

import type { Env } from '../../environment.js';

import { SESSION_COOKIE_NAME, verifySession } from './session.js';
import { DUMMY_SCRYPT_HASH, verifyScryptPassword } from './validator.js';

/**
 * Authenticates a request or handshake by either its `Authorization: Basic`
 * header (service-to-service, curl, Swagger) or the signed session cookie the
 * browser login sets. One validator, both transports.
 * @param headers - raw header map (values may be strings or string arrays)
 * @param config - parsed application env
 * @returns the authenticated username, or null
 */
export async function authenticateHeaders(
  headers: Record<string, string | string[] | undefined>,
  config: ConfigService<Env, true>,
): Promise<null | { username: string }> {
  const username = config.get('BASIC_AUTH_USERNAME', { infer: true });
  const passwordHash = config.get('BASIC_AUTH_PASSWORD_HASH', { infer: true });
  const sessionSecret = config.get('SESSION_SECRET', { infer: true });

  const authorization = firstHeader(headers['authorization']);
  if (authorization?.startsWith('Basic ')) {
    return authenticateBasic(authorization, username, passwordHash);
  }

  const cookieHeader = firstHeader(headers['cookie']);
  if (cookieHeader) {
    const parts = cookieHeader.split(';').map((part) => part.trim());
    const session = parts.find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`));
    // No known secret means no session can ever verify; fail closed without HMAC.
    if (session && sessionSecret) {
      const raw = session.slice(SESSION_COOKIE_NAME.length + 1);
      try {
        const value = decodeURIComponent(raw);
        const verified = verifySession(value, sessionSecret);
        if (verified) return { username: verified.username };
      } catch {
        // Malformed percent-encoding in the cookie: treat as no session.
        return null;
      }
    }
  }

  return null;
}

/**
 * Returns the first value of a possibly-multi-valued header, or undefined.
 * @param value - the raw header value (string, array or undefined)
 * @returns the first string value, or undefined when absent
 */
export function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value[0];
  return undefined;
}

/**
 * Verifies an `Authorization: Basic` header against the configured credential.
 * Always runs the KDF (against the real hash, or the dummy when the password
 * is unconfigured or the name differs) so the response time does not reveal
 * whether the username exists.
 * @param authorization - full header value, including the `Basic ` prefix
 * @param username - the configured basic-auth username
 * @param passwordHash - the configured scrypt hash, or undefined when unconfigured
 * @returns the authenticated username, or null
 */
async function authenticateBasic(
  authorization: string,
  username: string,
  passwordHash: string | undefined,
): Promise<null | { username: string }> {
  const decoded = Buffer.from(authorization.slice('Basic '.length).trim(), 'base64').toString(
    'utf8',
  );
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;

  const candidateName = decoded.slice(0, colon);
  const candidatePassword = decoded.slice(colon + 1);
  const passwordOk = await verifyScryptPassword(
    passwordHash ?? DUMMY_SCRYPT_HASH,
    candidatePassword,
  );
  if (Boolean(passwordHash) && candidateName === username && passwordOk) {
    return { username: candidateName };
  }
  return null;
}
