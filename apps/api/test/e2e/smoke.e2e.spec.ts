import type { ChildProcess } from 'node:child_process';

import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTempCluster, type TempCluster } from '../pg-temp.js';

/**
 * Process-level smoke test: boots the built API as a child process against a
 * throwaway PostgreSQL cluster, exercises the HTTP boundary end to end, and
 * checks that SIGTERM shuts down gracefully. Requires `npm run build` first
 * (the root `check` script builds before testing).
 */

const ADMIN_PASSWORD = 'e2e-password';
const API_DIR = path.join(__dirname, '..', '..');

/** Acknowledgement envelope returned by the WS translate handler. */
type TranslateAck = { data: null | string; requestId: null | string; statusCode: number };

/**
 * Builds the Basic authorization header for the seeded smoke credential.
 * @returns a single-entry header map
 */
function basicAuthHeader(): Record<string, string> {
  const credentials = Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
  return { authorization: `Basic ${credentials}` };
}

/**
 * Opens a websocket against a running child API and resolves once connected.
 * @param port - the child's listening port
 * @param headers - handshake headers (empty for the unauthenticated case)
 * @returns the connected socket
 */
function connectWs(port: number, headers: Record<string, string>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(`http://127.0.0.1:${port}`, {
      extraHeaders: headers,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('timeout waiting for websocket connect'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(error);
    });
  });
}

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
 * Spawns the built API and waits for it to exit, capturing its combined output.
 * Used only for negative boot cases that must fail fast before listening.
 * @param env - complete environment for the child
 * @param timeoutMs - how long to wait before killing the child and failing
 * @returns the exit code and everything the child wrote to stdout/stderr
 */
async function spawnToExit(
  env: NodeJS.ProcessEnv,
  timeoutMs = 15_000,
): Promise<{ code: null | number; output: string }> {
  const spawned = spawn(process.execPath, [path.join(API_DIR, 'dist', 'main.js')], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  spawned.stdout?.setEncoding('utf8');
  spawned.stderr?.setEncoding('utf8');
  spawned.stdout?.on('data', (chunk: string) => {
    output += chunk;
  });
  spawned.stderr?.on('data', (chunk: string) => {
    output += chunk;
  });

  const exited = new Promise<null | number>((resolve) => {
    spawned.once('exit', (code) => resolve(code));
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      spawned.kill('SIGKILL');
      reject(new Error(`child did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const code = await Promise.race([exited, timeout]);
    return { code, output };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  let sharedEnv: NodeJS.ProcessEnv;
  let child: undefined | { port: number; spawned: ChildProcess };
  const extraChildren: Array<ChildProcess> = [];

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_e2e_test');

    const { randomBytes, scryptSync } = await import('node:crypto');
    const salt = randomBytes(16);
    const hash = `scrypt$1024$8$1$${salt.toString('hex')}$${scryptSync(ADMIN_PASSWORD, salt, 64, {
      N: 1024,
      p: 1,
      r: 8,
    }).toString('hex')}`;

    sharedEnv = {
      ...process.env,
      BASIC_AUTH_PASSWORD_HASH: hash,
      BASIC_AUTH_USERNAME: 'admin',
      DATABASE_URL: cluster.url(),
      NODE_ENV: 'production',
      SESSION_SECRET: 'a'.repeat(64),
    };

    // Apply the committed migration before booting, exactly like production.
    execFileSync(process.execPath, [path.join(API_DIR, 'bin', 'db-migrate.mjs')], {
      env: sharedEnv,
      stdio: 'ignore',
    });

    const port = await reservePort();
    const spawned = spawn(process.execPath, [path.join(API_DIR, 'dist', 'main.js')], {
      env: { ...sharedEnv, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = { port, spawned };

    await waitForHealth(port);
  }, 90_000);

  afterAll(async () => {
    for (const spawned of extraChildren) {
      if (spawned.exitCode === null && spawned.signalCode === null) {
        spawned.kill('SIGTERM');
        await once(spawned, 'exit');
      }
    }
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

  it('rejects unauthenticated requests and issues a Secure session cookie on login', async () => {
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
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toMatch(/Max-Age=\d+/);

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
    const body: unknown = await authed.json();
    expect(body).toMatchObject({ info: { title: 'trainslator' }, openapi: '3.0.0' });

    const goldenText = readFileSync(
      path.join(__dirname, '..', 'fixtures', 'openapi.golden.json'),
      'utf8',
    );
    const golden: unknown = JSON.parse(goldenText);
    expect(body).toEqual(golden);
  });

  it('fails fast with a non-zero exit when the environment is invalid', async () => {
    const invalidEnv = { ...sharedEnv };
    delete invalidEnv.SESSION_SECRET;
    const { code, output } = await spawnToExit(invalidEnv);
    expect(code).toBe(1);
    expect(output).toContain('Invalid environment configuration');
    expect(output).toContain('SESSION_SECRET');
  });

  it('answers 429 once the configured per-minute quota is exhausted', async () => {
    const port = await reservePort();
    const spawned = spawn(process.execPath, [path.join(API_DIR, 'dist', 'main.js')], {
      env: { ...sharedEnv, PORT: String(port), THROTTLE_LIMIT: '2' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    extraChildren.push(spawned);
    // Health is excluded from the shared quota, so probing does not spend it.
    await waitForHealth(port);

    const url = `http://127.0.0.1:${port}/api/languages`;
    const headers = basicAuthHeader();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ok = await fetch(url, { headers });
      expect(ok.status, `attempt ${attempt + 1}`).toBe(200);
    }
    const limited = await fetch(url, { headers });
    expect(limited.status).toBe(429);
  }, 60_000);

  it('rejects an unauthenticated websocket handshake', async () => {
    if (!child) throw new Error('child not booted');
    await expect(connectWs(child.port, {})).rejects.toThrow();
  });

  it('accepts an authenticated websocket and acks an invalid frame with 400', async () => {
    if (!child) throw new Error('child not booted');
    const socket = await connectWs(child.port, basicAuthHeader());
    try {
      expect(socket.connected).toBe(true);
      const ack = await new Promise<TranslateAck>((resolve, reject) => {
        socket
          .timeout(5_000)
          .emit('translate', { text: 42 }, (error: Error | null, response?: TranslateAck) => {
            if (error) reject(error);
            else if (response) resolve(response);
            else reject(new Error('missing websocket ack'));
          });
      });
      expect(ack.statusCode).toBe(400);
      expect(ack.data).toBeNull();
      expect(ack.requestId).toBeNull();
    } finally {
      socket.disconnect();
    }
  });
});
