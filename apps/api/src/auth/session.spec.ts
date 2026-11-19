import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAME, signSession, verifySession } from './session';

const SECRET = 'a'.repeat(64);

describe('signSession/verifySession', () => {
  it('round-trips a signed session', () => {
    const { value } = signSession('admin', SECRET);
    expect(verifySession(value, SECRET)).toEqual({ username: 'admin' });
  });

  it('rejects a tampered payload', () => {
    const { value } = signSession('admin', SECRET);
    const [, signature] = value.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ u: 'root', exp: Date.now() + 10_000 }),
    ).toString('base64url');
    expect(verifySession(`${forgedPayload}.${signature}`, SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const { value } = signSession('admin', SECRET);
    const [segment] = value.split('.');
    expect(verifySession(`${segment}.deadbeef`, SECRET)).toBeNull();
  });

  it('rejects sessions signed with a different secret', () => {
    const { value } = signSession('admin', SECRET);
    expect(verifySession(value, 'b'.repeat(64))).toBeNull();
  });

  it('rejects expired sessions', () => {
    const { value } = signSession('admin', SECRET, -1_000);
    expect(verifySession(value, SECRET)).toBeNull();
  });

  it('rejects malformed values', () => {
    expect(verifySession('', SECRET)).toBeNull();
    expect(verifySession('no-dot-here', SECRET)).toBeNull();
    expect(verifySession('.sig', SECRET)).toBeNull();
    expect(verifySession('not-base64url.sig', SECRET)).toBeNull();
  });

  it('rejects a well-formed signature over a malformed payload shape', () => {
    const payload = Buffer.from(JSON.stringify({ u: 'admin' })).toString('base64url');
    const forged = `${payload}.${'a'.repeat(43)}`;
    expect(verifySession(forged, SECRET)).toBeNull();

    const badType = Buffer.from(JSON.stringify({ u: 5, exp: Date.now() + 1000 })).toString(
      'base64url',
    );
    const forged2 = `${badType}.${'a'.repeat(43)}`;
    expect(verifySession(forged2, SECRET)).toBeNull();
  });

  it('exposes a stable cookie name', () => {
    expect(SESSION_COOKIE_NAME).toBe('trainslator_session');
  });
});
