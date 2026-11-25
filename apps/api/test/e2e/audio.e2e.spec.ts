import type { ChildProcess } from 'node:child_process';

import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTempCluster, type TempCluster } from '../pg-temp.js';

/**
 * Process-level check for the speech-to-text route: boots the built API on a
 * throwaway PostgreSQL cluster and exercises the validation boundary over real
 * HTTP. A body missing `audio` is rejected by the zod pipe before the native
 * transcriber or any model download can start. Requires `npm run build` first.
 */

const ADMIN_PASSWORD = 'e2e-password';
const API_DIR = path.join(__dirname, '..', '..');
const STT_URL = '/api/audio/stt';

/**
 * Builds the Basic authorization header for the seeded audio e2e credential.
 * @returns a single-entry header map
 */
function basicAuthHeader(): Record<string, string> {
  const credentials = Buffer.from(`admin:${ADMIN_PASSWORD}`).toString('base64');
  return { authorization: `Basic ${credentials}` };
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
 * Polls /api/health until the child answers, with a timeout.
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

describe('e2e audio STT (real child process, throwaway PostgreSQL)', () => {
  let cluster: TempCluster;
  let sharedEnv: NodeJS.ProcessEnv;
  let child: undefined | { port: number; spawned: ChildProcess };

  beforeAll(async () => {
    cluster = startTempCluster('trainslator_e2e_audio_test');

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

  it('rejects a body missing audio with 400 before any native load', async () => {
    if (!child) throw new Error('child not booted');
    const response = await fetch(`http://127.0.0.1:${child.port}${STT_URL}`, {
      body: JSON.stringify({ language: 'auto' }),
      headers: { ...basicAuthHeader(), 'content-type': 'application/json' },
      method: 'POST',
    });
    expect(response.status).toBe(400);
    const body: unknown = await response.json();
    expect(body).toMatchObject({
      message: expect.arrayContaining([expect.stringContaining('audio')]),
      statusCode: 400,
    });
  });
});
