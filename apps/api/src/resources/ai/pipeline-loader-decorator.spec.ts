import { describe, expect, it, vi } from 'vitest';

// The Oxc decorator transform emits a defensive `typeof ConfigService ===
// "undefined" ? Object : ConfigService` metadata branch at the @Injectable()
// line. Loading the module with ConfigService absent exercises that branch.
vi.mock('@nestjs/config', () => ({ ConfigService: undefined }));
vi.mock('@huggingface/transformers', () => ({ pipeline: vi.fn() }));
vi.mock('./webgpu-globals.js', () => ({ ensureWebgpuGlobals: vi.fn() }));

import { PipelineLoader } from './pipeline-loader.js';
import { defaultModelFor } from './tasks.js';

describe('PipelineLoader without a runtime ConfigService binding', () => {
  it('still defines the class and resolves the registry default model', () => {
    const loader = new PipelineLoader({ get: () => undefined } as never);
    expect(loader.modelFor('sentiment')).toBe(defaultModelFor('sentiment'));
  });
});
