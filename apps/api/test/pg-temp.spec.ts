import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { resolvePgBin } from './pg-temp.js';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    readdirSync: () => {
      throw new Error('permission denied');
    },
  };
});

describe('resolvePgBin with an unreadable Debian-bin dir', () => {
  const originalBin = process.env.PG_BIN;

  it('honors the PG_BIN override', () => {
    process.env.PG_BIN = '/custom/pg/bin';
    expect(resolvePgBin()).toBe('/custom/pg/bin');
    if (originalBin === undefined) delete process.env.PG_BIN;
    else process.env.PG_BIN = originalBin;
  });

  it('falls back to an initdb found on PATH', () => {
    delete process.env.PG_BIN;
    const originalPath = process.env.PATH ?? '';
    const fakeBin = mkdtempSync(join(tmpdir(), 'trainslator-pgbin-'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test harness: fakeBin is a mkdtempSync-created dir, not caller input
    writeFileSync(join(fakeBin, 'initdb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}:${originalPath}`;
    try {
      expect(resolvePgBin()).toBe(fakeBin);
    } finally {
      process.env.PATH = originalPath;
      rmSync(fakeBin, { force: true, recursive: true });
    }
  });

  it('throws a clear error when no binaries can be located', () => {
    delete process.env.PG_BIN;
    // PATH on CI/dev machines here has no initdb either, so the PATH fallback
    // also fails and the error message must say so.
    expect(() => resolvePgBin()).toThrow(/PostgreSQL binaries not found/);
  });
});
