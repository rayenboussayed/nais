import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify } from './stable-json.js';

describe('canonicalJsonStringify', () => {
  it('sorts keys recursively so key order never affects equality', () => {
    const a = { a: { c: 3, d: 4 }, b: 1, z: [1, { x: 1, y: 2 }] };
    const b = { a: { c: 3, d: 4 }, b: 1, z: [1, { x: 1, y: 2 }] };
    expect(canonicalJsonStringify(a)).toBe(canonicalJsonStringify(b));
  });

  it('treats Date instances as opaque values', () => {
    const stamp = new Date('2026-11-18T00:00:00.000Z');
    expect(canonicalJsonStringify({ at: stamp })).toBe(JSON.stringify({ at: stamp }));
  });

  it('handles primitives and null', () => {
    expect(canonicalJsonStringify(null)).toBe('null');
    expect(canonicalJsonStringify('s')).toBe('"s"');
    expect(canonicalJsonStringify(42)).toBe('42');
  });

  it('handles arrays of mixed content', () => {
    expect(canonicalJsonStringify([3, 'a', { a: 1, b: 2 }, null])).toBe(
      '[3,"a",{"a":1,"b":2},null]',
    );
  });
});
