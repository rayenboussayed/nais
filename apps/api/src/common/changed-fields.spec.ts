import { describe, expect, it } from 'vitest';

import { changedFields } from './changed-fields.js';

describe('changedFields', () => {
  const before = {
    at: new Date('2026-11-18T00:00:00.000Z'),
    count: 3,
    maybe: null as null | string,
    meta: { flags: ['a'], nested: { b: 1 } },
    name: 'English',
  };

  it('returns only fields that actually differ', () => {
    expect(changedFields(before, { name: 'English' })).toEqual({});
    expect(changedFields(before, { name: 'German' })).toEqual({ name: 'German' });
  });

  it('compares objects by value', () => {
    expect(changedFields(before, { meta: { flags: ['a'], nested: { b: 1 } } })).toEqual({});
    expect(changedFields(before, { meta: { flags: ['b'], nested: { b: 1 } } })).toEqual({
      meta: { flags: ['b'], nested: { b: 1 } },
    });
  });

  it('compares dates by timestamp', () => {
    expect(changedFields(before, { at: new Date('2026-11-18T00:00:00.000Z') })).toEqual({});
    expect(changedFields(before, { at: new Date('2026-11-19T00:00:00.000Z') })).toEqual({
      at: new Date('2026-11-19T00:00:00.000Z'),
    });
  });

  it('treats null as a value, not as missing', () => {
    expect(changedFields(before, { maybe: null })).toEqual({});
    expect(changedFields(before, { maybe: 'set' })).toEqual({ maybe: 'set' });
  });

  it('ignores explicit undefined values', () => {
    expect(changedFields(before, { name: undefined })).toEqual({});
  });

  it('drops keys that do not exist in the before shape', () => {
    expect(
      changedFields(before, { __proto__: { polluted: true }, constructor: 'x', unknownField: 'y' }),
    ).toEqual({});
    expect(changedFields(before, { name: 'German', unknownField: 'x' })).toEqual({
      name: 'German',
    });
  });

  it('does not confuse undefined with null', () => {
    expect(changedFields(before, { maybe: undefined, name: 'German' })).toEqual({
      name: 'German',
    });
  });

  it('compares nested objects by value regardless of key order', () => {
    const beforeObj = { nested: { a: 1, b: 2, c: [1, 2, { x: 'y', z: 'w' }] } };
    const patch = { nested: { a: 1, b: 2, c: [1, 2, { x: 'y', z: 'w' }] } };
    expect(changedFields(beforeObj, patch)).toEqual({});

    expect(
      changedFields(beforeObj, { nested: { a: 1, b: 2, c: [1, 2, { x: 'y', z: 'W' }] } }),
    ).toEqual({
      nested: { a: 1, b: 2, c: [1, 2, { x: 'y', z: 'W' }] },
    });
  });

  it('treats a before-shape key holding undefined as undefined', () => {
    const beforeUndefined = { maybe: undefined as string | undefined };
    expect(changedFields(beforeUndefined, { maybe: 'x' })).toEqual({ maybe: 'x' });
    expect(changedFields(beforeUndefined, { maybe: undefined })).toEqual({});
  });

  it('treats reordered arrays as different values', () => {
    const beforeObj = { list: [1, 2, 3] };
    expect(changedFields(beforeObj, { list: [3, 2, 1] })).toEqual({ list: [3, 2, 1] });
    expect(changedFields(beforeObj, { list: [1, 2, 3] })).toEqual({});
  });
});
