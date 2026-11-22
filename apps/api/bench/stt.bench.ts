import { describe, test } from 'vitest';

import { sttRequestSchema } from '../src/schemas/audio.js';

/** Typical one-second 16 kHz mono audio payload, already base64 encoded. */
const AUDIO_BASE64 = Buffer.alloc(32_000, 7).toString('base64');
/** Parsed request reused by the validation benchmark. */
const REQUEST = { audio: AUDIO_BASE64, language: 'auto' };
/** One timed segment reused by the response benchmark. */
const SEGMENT = { end: 1200, start: 0, text: 'hello world' };

// Resolve the schema method once so the loop does not pay for the property load.
const parse = sttRequestSchema.parse.bind(sttRequestSchema);

/**
 * Microbenchmarks for the pure boundary work on every STT request. No native
 * module is loaded and no model is downloaded. Run: npm run test:perf
 */
describe('speech-to-text boundary hot paths', () => {
  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('base64-decodes a typical WAV payload', async ({ bench }) => {
    await bench('stt base64 decode', () => {
      Buffer.from(AUDIO_BASE64, 'base64');
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('validates a typical STT request', async ({ bench }) => {
    await bench('stt request parse', () => {
      parse(REQUEST);
    }).run();
  });

  // eslint-disable-next-line sonarjs/assertions-in-tests -- benchmarks measure throughput; an assertion inside the loop would distort the timing
  test('builds a typical STT response', async ({ bench }) => {
    await bench('stt response build', () => ({
      device: 'cpu',
      segments: [SEGMENT],
      text: 'hello world',
    })).run();
  });
});
