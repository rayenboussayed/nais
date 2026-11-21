import { useState } from 'react';

import type { KeysetCursor } from './types';

/** Cursor stack for keyset pagination: current page is always the last entry. */
export interface CursorStack {
  back: () => void;
  canBack: boolean;
  current: KeysetCursor | null;
  next: (cursor: KeysetCursor) => void;
  reset: () => void;
}

/**
 * Human-readable timestamp in the user's locale, or an em dash for missing.
 * @param iso - the ISO-8601 timestamp, or null/undefined
 * @returns the localized timestamp, or an em dash when missing
 */
export function formatTimestamp(iso: null | string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

/**
 * Stateful prev/next stack over keyset pages (no random access by design).
 * @returns the cursor stack API
 */
export function useCursorStack(): CursorStack {
  const [stack, setStack] = useState<KeysetCursor[]>([]);

  return {
    back: () => setStack((pages) => pages.slice(0, -1)),
    canBack: stack.length > 0,
    current: stack[stack.length - 1] ?? null,
    next: (cursor) => setStack((pages) => [...pages, cursor]),
    reset: () => setStack([]),
  };
}
