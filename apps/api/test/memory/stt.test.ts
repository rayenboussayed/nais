import { describe, expect, it } from 'vitest';

import { sttRequestSchema } from '../../src/schemas/audio.js';

/**
 * Memory smoke for the STT boundary: parsing and base64 decoding a typical
 * audio payload many times must not accumulate heap in a long-lived process.
 * Runs with --expose-gc (see vitest.memory.config.mts). A native model and a
 * database are out of scope; this is a smoke bound, not a proof of no leaks.
 */

const ITERATIONS = 100;
const HEAP_BUDGET_MB = 10;
/** Typical one-second 16 kHz mono audio payload, already base64 encoded. */
const AUDIO_BASE64 = Buffer.alloc(32_000, 7).toString('base64');

/** Result of each loop body; written here so the engine cannot elide it. */
let consumed: unknown;

describe('memory: repeated STT boundary operations', () => {
  it('stays under the heap budget after many parse and decode cycles', () => {
    for (let i = 0; i < 20; i += 1) {
      consumed = sttRequestSchema.parse({ audio: AUDIO_BASE64, language: 'auto' });
      consumed = Buffer.from(AUDIO_BASE64, 'base64');
    }
    global.gc?.();
    const before = process.memoryUsage().heapUsed;

    for (let i = 0; i < ITERATIONS; i += 1) {
      const parsed = sttRequestSchema.parse({ audio: AUDIO_BASE64, language: 'auto' });
      consumed = parsed;
      consumed = Buffer.from(parsed.audio, 'base64');
    }
    expect(consumed).toBeDefined();

    global.gc?.();
    const after = process.memoryUsage().heapUsed;
    const deltaMb = (after - before) / (1024 * 1024);

    expect(deltaMb).toBeLessThan(HEAP_BUDGET_MB);
  });
});
