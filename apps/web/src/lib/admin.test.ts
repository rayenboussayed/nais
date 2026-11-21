// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { KeysetCursor } from './types';

import { formatTimestamp, useCursorStack } from './admin';

describe('formatTimestamp', () => {
  it('renders a locale date for a valid iso string', () => {
    expect(formatTimestamp('2026-11-18T12:00:00.000Z')).not.toBe('—');
  });

  it('renders an em dash for missing values', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp(undefined)).toBe('—');
  });
});

describe('useCursorStack', () => {
  const first: KeysetCursor = {
    lastCreatedAt: '2026-11-18T23:05:21.809035+00',
    lastId: '00000000-0000-4000-8000-000000000001',
  };
  const second: KeysetCursor = {
    lastCreatedAt: '2026-11-18T23:06:21.809035+00',
    lastId: '00000000-0000-4000-8000-000000000002',
  };

  it('starts empty with no current cursor and no back navigation', () => {
    const { result } = renderHook(() => useCursorStack());
    expect(result.current.current).toBeNull();
    expect(result.current.canBack).toBe(false);
  });

  it('pushes shared-shaped cursors, tracks the current page and walks back', () => {
    const { result } = renderHook(() => useCursorStack());

    act(() => result.current.next(first));
    expect(result.current.current).toEqual(first);
    expect(result.current.canBack).toBe(true);

    act(() => result.current.next(second));
    expect(result.current.current).toEqual(second);
    expect(result.current.canBack).toBe(true);

    act(() => result.current.back());
    expect(result.current.current).toEqual(first);
    expect(result.current.canBack).toBe(true);
  });

  it('clears the whole stack on reset', () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.next(first));
    act(() => result.current.next(second));

    act(() => result.current.reset());
    expect(result.current.current).toBeNull();
    expect(result.current.canBack).toBe(false);
  });
});
