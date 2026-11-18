import { describe, expect, it } from 'vitest';

import { changedFields } from './changed-fields';

describe('changedFields', () => {
  const before = {
    name: 'English',
    count: 3,
    at: new Date('2026-11-18T00:00:00.000Z'),
    meta: { flags: ['a'], nested: { b: 1 } },
    maybe: null as null | string,
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
});
