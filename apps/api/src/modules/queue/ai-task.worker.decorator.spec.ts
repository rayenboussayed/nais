import { describe, expect, it, vi } from 'vitest';

vi.mock('../../resources/ai/ai.service.js', () => ({ AiService: undefined }));
vi.mock('../../resources/translate/translate.gateway.js', () => ({ TranslateGateway: undefined }));

describe('AiTaskWorker decorator fallback', () => {
  it('still defines the worker when decorator metadata cannot resolve collaborators', async () => {
    const { AiTaskWorker } = await import('./ai-task.worker.js');
    expect(AiTaskWorker).toBeTypeOf('function');
  });
});
