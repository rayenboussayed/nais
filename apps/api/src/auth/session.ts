import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'trainslator_session';

/** Stateless signed cookie payload, base64url-encoded. */
interface SessionPayload {
  /** Expiry, milliseconds since epoch. */
  exp: number;
  /** Username carried by the session. */
  u: string;
}

/**
 * Creates a signed session cookie value for `username`.
 * @param username - the username to bake into the session
 * @param secret - SESSION_SECRET (64+ random hex chars)
 * @param maxAgeMs - lifetime; default 12h
 * @returns the signed cookie value and its max-age in seconds
 */
export function signSession(
  username: string,
  secret: string,
  maxAgeMs: number = 12 * 60 * 60 * 1000,
): { maxAge: number; value: string } {
  const payload: SessionPayload = { exp: Date.now() + maxAgeMs, u: username };
  const segment = encodePayload(payload);
  return { maxAge: Math.floor(maxAgeMs / 1000), value: `${segment}.${sign(segment, secret)}` };
}

/**
 * Verifies a signed session cookie value.
 * @param value - raw cookie value (`segment.hmac`)
 * @param secret - SESSION_SECRET
 * @returns the session, or null when invalid, forged, or expired
 */
export function verifySession(value: string, secret: string): null | { username: string } {
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

/**
 * Decodes and shape-checks a base64url session segment.
 * @param segment - the base64url payload segment
 * @returns the parsed payload, or null when malformed
 */
function decodePayload(segment: string): null | SessionPayload {
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

/**
 * Encodes a session payload as base64url JSON.
 * @param payload - the session payload
 * @returns the base64url segment
 */
function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Signs a segment with HMAC-SHA256.
 * @param segment - the payload segment to sign
 * @param secret - SESSION_SECRET
 * @returns the base64url signature
 */
function sign(segment: string, secret: string): string {
  return createHmac('sha256', secret).update(segment).digest('base64url');
}
