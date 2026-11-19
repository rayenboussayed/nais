import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Throwaway PostgreSQL cluster for integration tests. Creates a fresh
 * cluster in a temp dir using unix sockets only (no TCP port, so no port
 * conflicts), applies SQL migrations once, and tears everything down in
 * {@link destroy}. Requires postgres binaries (Debian: `postgresql-XX`).
 * Nothing here touches developer or production databases.
 */

export interface TempCluster {
  dbName: string;
  destroy(): void;
  socketDir: string;
  /** Connection URL for node-postgres: unix socket via host=<socketDir>. */
  url(db?: string): string;
}

/**
 * Locates the postgres binaries: PG_BIN override, else the newest Debian-bin dir, else PATH.
 * @returns the directory holding the postgres binaries
 */
export function resolvePgBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const debianEntries = (() => {
    try {
      return readdirSync('/usr/lib/postgresql', { withFileTypes: true });
    } catch {
      return []; // /usr/lib/postgresql absent: fall through to the PATH lookup
    }
  })();
  const candidates = debianEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of candidates) {
    const dir = join('/usr/lib/postgresql', version, 'bin');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test harness: path from the fixed Debian layout constant, not caller input
    if (existsSync(join(dir, 'initdb'))) return dir;
  }
  const onPath = which('initdb');
  if (onPath) return dirname(onPath);
  throw new Error('PostgreSQL binaries not found; set PG_BIN or install postgresql');
}

/**
 * @param dbName - name of the test database to create
 * @param isReady - readiness probe; defaults to pg_isready against the socket
 * @param timeoutMs - readiness wait limit in milliseconds (PG_TEST_TIMEOUT_MS env honored when omitted)
 * @returns the temporary cluster handle (teardown via {@link TempCluster.destroy})
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
      detached: true,
      stdio: 'ignore',
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
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }

  try {
    execFileSync(join(pgBin, 'createdb'), ['-h', socketDir, '-p', port, '-U', 'postgres', dbName], {
      stdio: 'ignore',
    });
  } catch (error) {
    destroy();
    throw error;
  }

  /**
   * Connection URL for one database on this cluster.
   * @param db - the database to point at (defaults to the cluster's own db)
   * @returns the node-postgres connection URL for the socket dir
   */
  function url(db = dbName): string {
    return `postgresql://postgres@/${encodeURIComponent(db)}?host=${encodeURIComponent(socketDir)}&port=${port}`;
  }

  /**
   *
   */
  function destroy() {
    try {
      // -w: wait for the postmaster to actually stop before we remove the
      // cluster directory; otherwise the rm races the shutdown and leaks data.
      execFileSync(
        join(pgBin, 'pg_ctl'),
        ['-D', dataDir, '-m', 'immediate', '-w', '-t', '10', 'stop'],
        { stdio: 'ignore', timeout: 12_000 },
      );
    } catch (stopError: unknown) {
      // Best effort: the cluster may never have started; removal below still runs.
      process.emitWarning(
        'pg_ctl stop failed during test-cluster teardown; removing the directory anyway',
        { detail: stopError instanceof Error ? stopError.message : String(stopError) },
      );
    }
    rmSync(socketDir, { force: true, maxRetries: 10, recursive: true, retryDelay: 200 });
  }

  return { dbName, destroy, socketDir, url };
}

/**
 * Default readiness probe: pg_isready against the socket dir.
 * @param pgBin - directory holding pg_isready
 * @param socketDir - the unix socket directory
 * @param port - the cluster port
 * @returns the readiness probe callback
 */
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

/**
 * @param bin - binary name to locate on PATH
 * @returns the absolute path, or undefined when not present
 */
function which(bin: string): string | undefined {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- `which` itself is the PATH lookup; the tool under test is found via the environment by design
    const found = execFileSync('which', [bin], { encoding: 'utf8' }).trim();
    return found === '' ? undefined : found;
  } catch {
    return undefined;
  }
}
