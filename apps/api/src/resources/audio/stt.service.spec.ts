import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const avMock = vi.hoisted(() => ({
  decoderClose: vi.fn(),
  decoderCreate: vi.fn(),
  demuxerClose: vi.fn(),
  demuxerOpen: vi.fn(),
  transcriberClose: vi.fn(),
  transcriberCreate: vi.fn(),
}));

const fsMock = vi.hoisted(() => ({ existsSync: vi.fn() }));

const scenario = vi.hoisted(() => ({
  cpuFails: false,
  gpuFails: false,
  gpuVisible: false,
  hasAudio: true,
  segments: [] as Array<{ end: number; start: number; text: string }>,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, existsSync: fsMock.existsSync };
});

vi.mock('node-av/api', () => ({
  Decoder: { create: avMock.decoderCreate },
  Demuxer: { open: avMock.demuxerOpen },
  WhisperTranscriber: { create: avMock.transcriberCreate },
}));

import { sttResponseSchema } from '../../schemas/audio.js';
import { SttService } from './stt.service.js';

/** Constant message shared by the invalid-audio assertions. */
const INVALID_AUDIO_MESSAGE = 'Audio payload is invalid or unsupported';

/**
 * Builds a minimal native stream with one null terminator.
 * @returns an async generator that exercises the whole frame chain
 */
const nullStream = () =>
  (async function* () {
    yield null;
  })();

/** Env values SttService reads from the parsed config. */
type SttConfig = Record<string, number | string | undefined>;

/**
 * Stubs ConfigService.get for every key the constructor reads.
 * @param overrides - parsed config values to replace
 * @returns a ConfigService double
 */
function configStub(overrides: SttConfig = {}) {
  const values: SttConfig = {
    STT_DEVICE: 'auto',
    STT_MAX_CONCURRENCY: 1,
    STT_MODEL: 'base',
    STT_MODEL_DIR: '/models',
    ...overrides,
  };
  return {
    // eslint-disable-next-line security/detect-object-injection -- test stub keys are compile-time constants
    get: (key: string) => values[key],
  } as never;
}

beforeEach(() => {
  avMock.decoderClose.mockReset();
  avMock.decoderCreate.mockReset();
  avMock.demuxerClose.mockReset();
  avMock.demuxerOpen.mockReset();
  avMock.transcriberClose.mockReset();
  avMock.transcriberCreate.mockReset();
  fsMock.existsSync.mockReset();
  scenario.cpuFails = false;
  scenario.gpuFails = false;
  scenario.gpuVisible = false;
  scenario.hasAudio = true;
  scenario.segments = [{ end: 900, start: 100, text: 'hello' }];

  fsMock.existsSync.mockImplementation(
    (path: unknown) => scenario.gpuVisible && (path === '/dev/dri' || path === '/dev/nvidia0'),
  );
  avMock.demuxerOpen.mockImplementation(async () => ({
    audio: () => (scenario.hasAudio ? { index: 3 } : undefined),
    close: avMock.demuxerClose,
    packets: nullStream,
  }));
  avMock.decoderCreate.mockImplementation(async () => ({
    close: avMock.decoderClose,
    frames: nullStream,
  }));
  avMock.transcriberCreate.mockImplementation(async (options: { useGpu?: boolean }) => ({
    close: avMock.transcriberClose,
    transcribe: () =>
      (async function* () {
        if (
          (options.useGpu === true && scenario.gpuFails) ||
          (options.useGpu !== true && scenario.cpuFails)
        ) {
          throw new Error('native failure text must not leak');
        }
        for (const segment of scenario.segments) {
          yield segment;
        }
      })(),
  }));
});

describe('SttService configuration', () => {
  it('uses the multilingual base model and CPU when no GPU is visible', async () => {
    const audio = Buffer.from('audio-fixture');
    const result = await new SttService(configStub()).transcribe(audio);

    expect(avMock.transcriberCreate).toHaveBeenCalledWith({
      language: 'auto',
      model: 'base',
      modelDir: '/models',
      queue: 3,
      useGpu: false,
    });
    expect(avMock.demuxerOpen).toHaveBeenCalledWith(audio);
    expect(result.device).toBe('cpu');
    expect(result.text).toBe('hello');
  });

  it('uses the GPU in auto mode when a device is visible', async () => {
    scenario.gpuVisible = true;
    const result = await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'));

    expect(avMock.transcriberCreate).toHaveBeenCalledTimes(1);
    expect(avMock.transcriberCreate.mock.calls[0]?.[0]).toMatchObject({ useGpu: true });
    expect(result.device).toBe('gpu');
  });

  it('honors a gpu pin even when no device is visible', async () => {
    const service = new SttService(configStub({ STT_DEVICE: 'gpu' }));
    const result = await service.transcribe(Buffer.from('audio-fixture'));

    expect(avMock.transcriberCreate).toHaveBeenCalledTimes(1);
    expect(avMock.transcriberCreate.mock.calls[0]?.[0]).toMatchObject({ useGpu: true });
    expect(result.device).toBe('gpu');
  });

  it('pins CPU and skips the GPU even when a device is visible', async () => {
    scenario.gpuVisible = true;
    const service = new SttService(configStub({ STT_DEVICE: 'cpu' }));
    const result = await service.transcribe(Buffer.from('audio-fixture'));

    expect(avMock.transcriberCreate).toHaveBeenCalledTimes(1);
    expect(avMock.transcriberCreate.mock.calls[0]?.[0]).toMatchObject({ useGpu: false });
    expect(result.device).toBe('cpu');
  });

  it('passes configured model, model directory and concurrency through', async () => {
    const service = new SttService(
      configStub({
        STT_MAX_CONCURRENCY: 2,
        STT_MODEL: 'large-v3',
        STT_MODEL_DIR: '/custom-models',
      }),
    );
    await service.transcribe(Buffer.from('audio-fixture'));

    expect(avMock.transcriberCreate).toHaveBeenCalledWith({
      language: 'auto',
      model: 'large-v3',
      modelDir: '/custom-models',
      queue: 3,
      useGpu: false,
    });
  });
});

describe('SttService transcription', () => {
  it('retries on CPU from the retained buffer after a GPU failure', async () => {
    scenario.gpuVisible = true;
    scenario.gpuFails = true;
    const audio = Buffer.from('audio-fixture');
    const result = await new SttService(configStub()).transcribe(audio);

    expect(avMock.transcriberCreate.mock.calls.map((call) => call[0].useGpu)).toEqual([
      true,
      false,
    ]);
    expect(avMock.demuxerOpen.mock.calls).toEqual([[audio], [audio]]);
    expect(avMock.decoderClose).toHaveBeenCalledTimes(2);
    expect(avMock.transcriberClose).toHaveBeenCalledTimes(2);
    expect(avMock.demuxerClose).toHaveBeenCalledTimes(2);
    expect(result.device).toBe('cpu');
    expect(result.text).toBe('hello');
  });

  it('throws a constant 503 when every device fails', async () => {
    scenario.gpuVisible = true;
    scenario.gpuFails = true;
    scenario.cpuFails = true;
    const error = await new SttService(configStub())
      .transcribe(Buffer.from('audio-fixture'))
      .catch((caught: unknown) => caught);

    const message = error instanceof Error ? error.message : String(error);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(message).toBe('Speech-to-text is unavailable');
    expect(message).not.toContain('native failure text');
    expect(avMock.transcriberCreate).toHaveBeenCalledTimes(2);
    expect(avMock.decoderClose).toHaveBeenCalledTimes(2);
    expect(avMock.transcriberClose).toHaveBeenCalledTimes(2);
    expect(avMock.demuxerClose).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for a payload with no audio stream without retrying', async () => {
    scenario.gpuVisible = true;
    scenario.hasAudio = false;
    const error = await new SttService(configStub())
      .transcribe(Buffer.from('audio-fixture'))
      .catch((caught: unknown) => caught);

    const message = error instanceof Error ? error.message : String(error);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(message).toBe('Audio payload contains no audio stream');
    expect(avMock.transcriberCreate).not.toHaveBeenCalled();
    expect(avMock.decoderClose).not.toHaveBeenCalled();
    expect(avMock.demuxerClose).toHaveBeenCalledTimes(1);
  });

  it('closes all native handles on a successful transcription', async () => {
    await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'));

    expect(avMock.decoderClose).toHaveBeenCalledTimes(1);
    expect(avMock.transcriberClose).toHaveBeenCalledTimes(1);
    expect(avMock.demuxerClose).toHaveBeenCalledTimes(1);
  });

  it('passes an explicit language through to the transcriber', async () => {
    await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'), 'fr');

    expect(avMock.transcriberCreate.mock.calls[0]?.[0]).toMatchObject({ language: 'fr' });
  });

  it('joins segment texts with a space', async () => {
    scenario.segments = [
      { end: 900, start: 100, text: 'hello' },
      { end: 1800, start: 1000, text: 'world' },
    ];
    const result = await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'));

    expect(result.text).toBe('hello world');
    expect(result.segments).toEqual(scenario.segments);
  });

  it('returns empty text and no segments for an empty transcript', async () => {
    scenario.segments = [];
    const result = await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'));

    expect(result.text).toBe('');
    expect(result.segments).toEqual([]);
  });

  it('releases the concurrency permit after a failure', async () => {
    scenario.cpuFails = true;
    const service = new SttService(configStub());
    await expect(service.transcribe(Buffer.from('audio-fixture'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    scenario.cpuFails = false;
    await expect(service.transcribe(Buffer.from('audio-fixture'))).resolves.toMatchObject({
      device: 'cpu',
    });
    expect(avMock.transcriberCreate).toHaveBeenCalledTimes(2);
  });

  it('rounds float Whisper timestamps to satisfy the integer wire contract', async () => {
    scenario.segments = [{ end: 900.7, start: 100.4, text: 'hello' }];
    const result = await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'));

    expect(result.segments).toEqual([{ end: 901, start: 100, text: 'hello' }]);
    expect(sttResponseSchema.safeParse(result).success).toBe(true);
  });

  it('returns 400 and closes the demuxer when Decoder.create rejects', async () => {
    avMock.decoderCreate.mockRejectedValueOnce(new Error('codec setup failed'));
    const error = await new SttService(configStub())
      .transcribe(Buffer.from('audio-fixture'))
      .catch((caught: unknown) => caught);

    const message = error instanceof Error ? error.message : String(error);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(message).toBe(INVALID_AUDIO_MESSAGE);
    expect(avMock.demuxerClose).toHaveBeenCalledTimes(1);
    expect(avMock.decoderClose).not.toHaveBeenCalled();
    expect(avMock.transcriberCreate).not.toHaveBeenCalled();
  });

  it('returns 400 with a constant message when Demuxer.open rejects', async () => {
    avMock.demuxerOpen.mockRejectedValueOnce(new Error('demux rejected bytes'));
    const error = await new SttService(configStub())
      .transcribe(Buffer.from('audio-fixture'))
      .catch((caught: unknown) => caught);

    const message = error instanceof Error ? error.message : String(error);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(message).toBe(INVALID_AUDIO_MESSAGE);
    expect(avMock.decoderCreate).not.toHaveBeenCalled();
    expect(avMock.demuxerClose).not.toHaveBeenCalled();
  });

  it('keeps the original 400 when demuxer cleanup rejects', async () => {
    scenario.hasAudio = false;
    avMock.demuxerClose.mockRejectedValueOnce(new Error('demux close failed'));
    const error = await new SttService(configStub())
      .transcribe(Buffer.from('audio-fixture'))
      .catch((caught: unknown) => caught);

    const message = error instanceof Error ? error.message : String(error);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(message).toBe('Audio payload contains no audio stream');
  });

  it('runs the remaining cleanup steps when sync closes throw', async () => {
    avMock.transcriberClose.mockImplementationOnce(() => {
      throw new Error('transcriber close failed');
    });
    avMock.decoderClose.mockImplementationOnce(() => {
      throw new Error('decoder close failed');
    });
    const result = await new SttService(configStub()).transcribe(Buffer.from('audio-fixture'));

    expect(result.text).toBe('hello');
    expect(avMock.demuxerClose).toHaveBeenCalledTimes(1);
  });
});
