import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { keysetListSchema } from './list';

const itemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
});

describe('keysetListSchema', () => {
  const list = keysetListSchema(itemSchema);

  it('wraps items with a nullable cursor', () => {
    const parsed = list.parse({
      items: [{ id: '123e4567-e89b-42d3-a456-426655440000', name: 'a' }],
      next: null,
    });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.next).toBeNull();
  });

  it('parses a non-null cursor pair', () => {
    const parsed = list.parse({
      items: [],
      next: {
        lastCreatedAt: '2026-11-18T23:05:21.809035+00',
        lastId: '123e4567-e89b-42d3-a456-426655440000',
      },
    });
    expect(parsed.next?.lastId).toBe('123e4567-e89b-42d3-a456-426655440000');
    expect(parsed.next?.lastCreatedAt).toBe('2026-11-18T23:05:21.809035+00');
  });

  it('rejects a cursor with a non-uuid lastId', () => {
    expect(() =>
      list.parse({
        items: [],
        next: { lastCreatedAt: '2026-11-18T00:00:00.000Z', lastId: 'nope' },
      }),
    ).toThrow();
  });
});
