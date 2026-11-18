import type { Dirent } from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { resolvePgBin } from './pg-temp';

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    readdirSync: () => [{ name: '99', isDirectory: () => true }] as unknown as Dirent[],
    existsSync: () => false,
  };
});

describe('resolvePgBin with a Debian-bin dir lacking initdb', () => {
  const originalPath = process.env.PATH ?? '';
  const originalBin = process.env.PG_BIN;

  it('falls through to PATH and finds an initdb there', () => {
    delete process.env.PG_BIN;
    const fakeBin = mkdtempSync(join(tmpdir(), 'trainslator-pgbin-'));
    writeFileSync(join(fakeBin, 'initdb'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    process.env.PATH = `${fakeBin}:${originalPath}`;
    try {
      expect(resolvePgBin()).toBe(fakeBin);
    } finally {
      process.env.PATH = originalPath;
      if (originalBin === undefined) delete process.env.PG_BIN;
      else process.env.PG_BIN = originalBin;
      rmSync(fakeBin, { recursive: true, force: true });
    }
  });
});
