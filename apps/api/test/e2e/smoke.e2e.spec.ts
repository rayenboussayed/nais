import type { ChildProcess } from 'node:child_process';

import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTempCluster, type TempCluster } from '../pg-temp.js';

/**
 * Process-level smoke test: boots the built API as a child process against a
 * throwaway PostgreSQL cluster, exercises the HTTP boundary end to end, and
 * checks that SIGTERM shuts down gracefully. Requires `npm run build` first
 * (the root `check` script builds before testing).
 */

const ADMIN_PASSWORD = 'e2e-password';

/**
 * Reserves an ephemeral localhost port for the child process.
 * @returns the reserved port
 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('no ephemeral port'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Polls /api/health until it answers, with a timeout.
 * @param port - the port the child app is listening on
 * @param timeoutMs - how long to wait before failing
 */
async function waitForHealth(port: number, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | undefined;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (Date.now() > deadline) {
      throw new Error(
        `API did not become healthy in time; last probe: ${lastError ?? 'no response captured'}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('e2e smoke (real child process, throwaway PostgreSQL)', () => {
  let cluster: TempCluster;
  let child: undefined | { port: number; spawned: ChildProcess };

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_e2e_test');

    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16);
    const hash = `scrypt$1024$8$1$${salt.toString('hex')}$${scryptSync(ADMIN_PASSWORD, salt, 64, {
      N: 1024,
      p: 1,
      r: 8,
    }).toString('hex')}`;

    const apiDir = path.join(__dirname, '..', '..');
    const sharedEnv = {
      ...process.env,
      BASIC_AUTH_PASSWORD_HASH: hash,
      BASIC_AUTH_USERNAME: 'admin',
      DATABASE_URL: cluster.url(),
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(64),
    };

    // Apply the committed migration before booting, exactly like production.
    execFileSync(process.execPath, [path.join(apiDir, 'bin', 'db-migrate.mjs')], {
      env: sharedEnv,
      stdio: 'ignore',
    });

    const port = await reservePort();
    const spawned = spawn(process.execPath, [path.join(apiDir, 'dist', 'main.js')], {
      env: { ...sharedEnv, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = { port, spawned };

    await waitForHealth(port);
  }, 90_000);

  afterAll(async () => {
    if (!child) {
      cluster.destroy();
      return;
    }
    const { spawned } = child;
    spawned.kill('SIGTERM');
    const [code] = await once(spawned, 'exit');
    cluster.destroy();
    expect(code).toBe(0);
  });

  it('answers 200 on /api/health without credentials', async () => {
    const response = await fetch(`http://127.0.0.1:${child?.port}/api/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('rejects unauthenticated requests and issues a session cookie on login', async () => {
    const unauth = await fetch(`http://127.0.0.1:${child?.port}/api/languages`);
    expect(unauth.status).toBe(401);

    const login = await fetch(`http://127.0.0.1:${child?.port}/api/auth/login`, {
      body: JSON.stringify({ password: ADMIN_PASSWORD, username: 'admin' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie');
    expect(setCookie).toContain('trainslator_session=');

    const session = /trainslator_session=[^;]+/.exec(setCookie ?? '')?.[0];
    if (!session) throw new Error('missing session cookie');

    const authed = await fetch(`http://127.0.0.1:${child?.port}/api/languages?pageSize=5`, {
      headers: { cookie: session },
    });
    expect(authed.status).toBe(200);
  });

  it('serves the OpenAPI document behind auth', async () => {
    const open = await fetch(`http://127.0.0.1:${child?.port}/api/docs-json`);
    expect(open.status).toBe(401);

    const credentials = Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
    const authed = await fetch(`http://127.0.0.1:${child?.port}/api/docs-json`, {
      headers: {
        authorization: `Basic ${credentials}`,
      },
    });
    expect(authed.status).toBe(200);
    const body = (await authed.json()) as { info?: { title?: string }; openapi: string };
    expect(body.info?.title).toBe('trainslator');
  });
});
