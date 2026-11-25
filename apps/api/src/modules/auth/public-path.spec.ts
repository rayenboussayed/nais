import { describe, expect, it } from 'vitest';

import { HEALTH_PATH } from './public-path.js';

describe('HEALTH_PATH', () => {
  it('names the liveness probe path', () => {
    expect(HEALTH_PATH).toBe('/api/health');
  });
});
