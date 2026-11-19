import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'trainslator_session';

/** Stateless signed cookie payload, base64url-encoded. */
interface SessionPayload {
  /** Username carried by the session. */
  u: string;
  /** Expiry, milliseconds since epoch. */
  exp: number;
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodePayload(segment: string): SessionPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as SessionPayload).u !== 'string' ||
      typeof (parsed as SessionPayload).exp !== 'number'
    ) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

function sign(segment: string, secret: string): string {
  return createHmac('sha256', secret).update(segment).digest('base64url');
}

/**
 * Creates a signed session cookie value for `username`.
 *
 * @param secret - SESSION_SECRET (64+ random hex chars)
 * @param maxAgeMs - lifetime; default 12h
 */
export function signSession(
  username: string,
  secret: string,
  maxAgeMs: number = 12 * 60 * 60 * 1000,
): { value: string; maxAge: number } {
  const payload: SessionPayload = { u: username, exp: Date.now() + maxAgeMs };
  const segment = encodePayload(payload);
  return { value: `${segment}.${sign(segment, secret)}`, maxAge: Math.floor(maxAgeMs / 1000) };
}

/**
 * Verifies a signed session cookie value.
 *
 * @param value - raw cookie value (`segment.hmac`)
 * @param secret - SESSION_SECRET
 * @returns the session, or null when invalid, forged, or expired
 */
export function verifySession(value: string, secret: string): { username: string } | null {
  const dot = value.indexOf('.');
  if (dot <= 0) return null;

  const segment = value.slice(0, dot);
  const signature = value.slice(dot + 1);
  const expected = sign(segment, secret);

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  const payload = decodePayload(segment);
  if (!payload || payload.exp < Date.now()) return null;
  return { username: payload.u };
}
