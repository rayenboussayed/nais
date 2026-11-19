// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetch } from './api';
import { hasSession, invalidateSessionProbe } from './session';

vi.mock('./api', async (importOriginal) => {
  const original = await importOriginal<typeof import('./api')>();
  return {
    ...original,
    apiFetch: vi.fn(),
  };
});

describe('hasSession', () => {
  beforeEach(() => {
    vi.mocked(apiFetch).mockReset();
    invalidateSessionProbe();
  });

  afterEach(() => {
    invalidateSessionProbe();
    vi.restoreAllMocks();
  });

  it('returns true when the probe succeeds and caches the result', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ items: [], next: null });
    expect(await hasSession()).toBe(true);
    expect(await hasSession()).toBe(true);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('returns false on failure and caches the negative briefly', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('unauthorized'));
    expect(await hasSession()).toBe(false);
    expect(await hasSession()).toBe(false);
    expect(vi.mocked(apiFetch)).toHaveBeenCalledTimes(1);
  });

  it('re-probes after invalidateSessionProbe is called', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('unauthorized'));
    expect(await hasSession()).toBe(false);

    invalidateSessionProbe();
    vi.mocked(apiFetch).mockResolvedValue({ items: [], next: null });
    expect(await hasSession()).toBe(true);
  });
});
