import { useState } from 'react';

/** Cursor stack for keyset pagination: current page is always the last entry. */
export interface CursorStack {
  current: KeysetCursor | null;
  canBack: boolean;
  next: (cursor: KeysetCursor) => void;
  back: () => void;
  reset: () => void;
}

interface KeysetCursor {
  lastId: string;
  lastCreatedAt: string;
}

/** Stateful prev/next stack over keyset pages (no random access by design). */
export function useCursorStack(): CursorStack {
  const [stack, setStack] = useState<KeysetCursor[]>([]);

  return {
    current: stack.length > 0 ? (stack[stack.length - 1] ?? null) : null,
    canBack: stack.length > 0,
    next: (cursor) => setStack((pages) => [...pages, cursor]),
    back: () => setStack((pages) => pages.slice(0, -1)),
    reset: () => setStack([]),
  };
}

/** Human-readable timestamp in the user's locale, or an em dash for missing. */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}
