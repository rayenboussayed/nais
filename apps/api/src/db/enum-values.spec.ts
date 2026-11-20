import { describe, expect, it } from 'vitest';

import { toPgEnumValues } from './enum-values.js';

describe('toPgEnumValues', () => {
  it('copies options into a new, mutable tuple without aliasing the input', () => {
    const options = ['ltr', 'rtl'] as const;
    const result = toPgEnumValues(options);

    expect(result).toEqual(['ltr', 'rtl']);
    expect(result).not.toBe(options);
  });

  it('throws for an empty options array instead of returning an invalid tuple', () => {
    expect(() => toPgEnumValues([])).toThrow('pgEnum requires at least one value');
  });
});
