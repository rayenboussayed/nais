import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

/**
 * Throwaway PostgreSQL cluster for integration tests. Creates a fresh
 * cluster in a temp dir using unix sockets only (no TCP port, so no port
 * conflicts), applies SQL migrations once, and tears everything down in
 * {@link destroy}. Requires postgres binaries (Debian: `postgresql-XX`).
 * Nothing here touches developer or production databases.
 */

export interface TempCluster {
  /** Connection URL for node-postgres: unix socket via host=<socketDir>. */
  url(db?: string): string;
  dbName: string;
  socketDir: string;
  destroy(): void;
}

/** Default readiness probe: pg_isready against the socket dir. */
function defaultPgIsReady(pgBin: string, socketDir: string, port: string): () => boolean {
  return () => {
    try {
      execFileSync(join(pgBin, 'pg_isready'), ['-h', socketDir, '-p', port, '-U', 'postgres'], {
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  };
}

/** Locates the postgres binaries: PG_BIN override, else the newest Debian-bin dir, else PATH. Exported for tests. */
export function resolvePgBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  try {
    const candidates = readdirSync('/usr/lib/postgresql', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of candidates) {
      const dir = join('/usr/lib/postgresql', version, 'bin');
      if (existsSync(join(dir, 'initdb'))) return dir;
    }
  } catch {
    // fall through to PATH
  }
  try {
    const found = execFileSync('which', ['initdb'], { encoding: 'utf8' }).trim();
    if (found) return dirname(found);
  } catch {
    // initdb is not on PATH either
  }
  throw new Error('PostgreSQL binaries not found; set PG_BIN or install postgresql');
}

/**
 * @param dbName - name of the test database to create
 * @param isReady - readiness probe; defaults to pg_isready against the socket
 * @param timeoutMs - readiness wait limit in milliseconds (PG_TEST_TIMEOUT_MS env honored when omitted)
 */
export function startTempCluster(
  dbName = 'trainslator_test',
  isReady?: () => boolean,
  timeoutMs?: number,
): TempCluster {
  const pgBin = resolvePgBin();
  const socketDir = mkdtempSync(join(tmpdir(), 'trainslator-pg-'));
  const dataDir = join(socketDir, 'data');
  const logFile = join(socketDir, 'postgres.log');
  const port = String(55400 + (process.pid % 500));

  execFileSync(
    join(pgBin, 'initdb'),
    ['-D', dataDir, '-U', 'postgres', '--auth=trust', '--no-sync', '-E', 'UTF8'],
    { stdio: 'ignore' },
  );
  const proc = spawn(
    join(pgBin, 'pg_ctl'),
    [
      '-D',
      dataDir,
      '-l',
      logFile,
      '-o',
      `-k ${socketDir} -p ${port} -c listen_addresses=''`,
      '-w',
      'start',
    ],
    {
      stdio: 'ignore',
      detached: true,
    },
  );
  proc.unref();

  // Wait until the server answers on the socket (pg_isready against a unix socket dir).
  const timeout = Number(timeoutMs ?? process.env.PG_TEST_TIMEOUT_MS ?? 30_000);
  const deadline = Date.now() + (Number.isFinite(timeout) ? timeout : 30_000);
  const ready = isReady ?? defaultPgIsReady(pgBin, socketDir, port);
  for (;;) {
    if (ready()) break;
    if (Date.now() > deadline) {
      destroy();
      throw new Error(`postgres test cluster did not start; see ${logFile}`);
    }
    execFileSync('sleep', ['0.1']);
  }

  try {
    execFileSync(join(pgBin, 'createdb'), ['-h', socketDir, '-p', port, '-U', 'postgres', dbName], {
      stdio: 'ignore',
    });
  } catch (error) {
    destroy();
    throw error;
  }

  function url(db = dbName): string {
    return `postgresql://postgres@/${encodeURIComponent(db)}?host=${encodeURIComponent(socketDir)}&port=${port}`;
  }

  function destroy() {
    try {
      // -w: wait for the postmaster to actually stop before we remove the
      // cluster directory; otherwise the rm races the shutdown and leaks data.
      execFileSync(
        join(pgBin, 'pg_ctl'),
        ['-D', dataDir, '-m', 'immediate', '-w', '-t', '10', 'stop'],
        { stdio: 'ignore', timeout: 12_000 },
      );
    } catch {
      // The cluster may never have started; removal below is still required.
    }
    rmSync(socketDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  return { url, dbName, socketDir, destroy };
}
