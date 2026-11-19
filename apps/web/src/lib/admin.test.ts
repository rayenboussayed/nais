import { describe, expect, it } from 'vitest';

import { formatTimestamp } from './admin';

describe('formatTimestamp', () => {
  it('renders a locale date for a valid iso string', () => {
    expect(formatTimestamp('2026-11-18T12:00:00.000Z')).not.toBe('—');
  });

  it('renders an em dash for missing values', () => {
    expect(formatTimestamp(null)).toBe('—');
    expect(formatTimestamp(undefined)).toBe('—');
  });
});
