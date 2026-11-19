// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCursorStack } from './admin';

const first = {
  lastId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  lastCreatedAt: '2026-11-18T00:00:01.000Z',
};
const second = {
  lastId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  lastCreatedAt: '2026-11-18T00:00:02.000Z',
};

describe('useCursorStack', () => {
  it('starts empty with no back capability', () => {
    const { result } = renderHook(() => useCursorStack());
    expect(result.current.current).toBeNull();
    expect(result.current.canBack).toBe(false);
  });

  it('advances and rewinds through pages', () => {
    const { result } = renderHook(() => useCursorStack());

    act(() => result.current.next(first));
    expect(result.current.canBack).toBe(true);
    expect(result.current.current).toEqual(first);

    act(() => result.current.next(second));
    expect(result.current.current).toEqual(second);

    act(() => result.current.back());
    expect(result.current.current).toEqual(first);

    act(() => result.current.back());
    expect(result.current.current).toBeNull();
    expect(result.current.canBack).toBe(false);
  });

  it('reset drops the whole stack', () => {
    const { result } = renderHook(() => useCursorStack());

    act(() => result.current.next(first));
    act(() => result.current.next(second));
    act(() => result.current.reset());

    expect(result.current.current).toBeNull();
    expect(result.current.canBack).toBe(false);
  });

  it('back() is a no-op at the bottom of the stack', () => {
    const { result } = renderHook(() => useCursorStack());
    act(() => result.current.back());
    expect(result.current.current).toBeNull();
    expect(result.current.canBack).toBe(false);
  });
});
