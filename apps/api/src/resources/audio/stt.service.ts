import { BadRequestException, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync } from 'node:fs';

import type { Env } from '../../environment.js';
import type { SttResponse, SttSegment } from '../../schemas/audio.js';

import { Semaphore } from '../../utils/semaphore.js';

const logger = new Logger('SttService');
const STT_CLEANUP_MESSAGE = 'Native cleanup failed';
const STT_INVALID_AUDIO_MESSAGE = 'Audio payload is invalid or unsupported';
const STT_NO_AUDIO_MESSAGE = 'Audio payload contains no audio stream';
const STT_UNAVAILABLE_MESSAGE = 'Speech-to-text is unavailable';

/** Decoder handle returned by the lazily imported native API. */
type NativeDecoder = Awaited<ReturnType<NodeAvApi['Decoder']['create']>>;
/** Transcriber handle returned by the lazily imported native API. */
type NativeTranscriber = Awaited<ReturnType<NodeAvApi['WhisperTranscriber']['create']>>;
/** Shape of the lazily imported native API, used for types only. */
type NodeAvApi = typeof import('node-av/api');

/**
 * Whisper-backed speech to text for `POST /api/audio/stt`.
 *
 * The native module is imported inside {@link transcribeOnce} so OpenAPI
 * generation and unit tests never load its binaries. Device selection is
 * decided once at boot: an explicit `STT_DEVICE=cpu` pin stays on CPU,
 * `gpu` and `auto` try GPU first when the host exposes a device, and every
 * device failure falls through to CPU. Concurrency is bounded by one permit
 * for the whole device chain, because node-av runs native work on the four
 * libuv worker threads.
 */
export class SttService {
  private readonly deviceChain: ReadonlyArray<SttResponse['device']>;
  private readonly gate: Semaphore;
  private readonly model: Env['STT_MODEL'];
  private readonly modelDir: string;

  constructor(config: ConfigService<Env, true>) {
    this.model = config.get('STT_MODEL', { infer: true });
    this.modelDir = config.get('STT_MODEL_DIR', { infer: true });
    this.gate = new Semaphore(config.get('STT_MAX_CONCURRENCY', { infer: true }));

    // Boot-time heuristic only: a broken driver can still fail GPU init, which
    // is why the CPU fallback and the explicit cpu pin exist.
    const gpuVisible = existsSync('/dev/dri') || existsSync('/dev/nvidia0');
    const pin = config.get('STT_DEVICE', { infer: true });
    if (pin === 'cpu') {
      this.deviceChain = ['cpu'];
    } else if (pin === 'gpu' || gpuVisible) {
      this.deviceChain = ['gpu', 'cpu'];
    } else {
      this.deviceChain = ['cpu'];
    }
  }

  /**
   * Transcribes base64-decoded audio, retrying on CPU after a GPU failure.
   * @param audio - decoded audio bytes, retained so every attempt reopens from the start
   * @param language - optional language selector; `auto` detection is the default
   * @returns joined text, timed segments and the device that produced them
   * @throws BadRequestException when the payload is invalid or has no audio stream
   * @throws ServiceUnavailableException when every device in the chain fails
   */
  async transcribe(audio: Buffer, language?: string): Promise<SttResponse> {
    return this.gate.run(async () => {
      for (const device of this.deviceChain) {
        try {
          return await this.transcribeOnce(audio, device === 'gpu', language);
        } catch (error) {
          // A malformed payload fails identically on every device; surface the 400.
          if (error instanceof BadRequestException) throw error;
          logger.warn(`speech-to-text failed on device=${device}`);
        }
      }
      throw new ServiceUnavailableException(STT_UNAVAILABLE_MESSAGE);
    });
  }

  private async transcribeOnce(
    audio: Buffer,
    useGpu: boolean,
    language?: string,
  ): Promise<SttResponse> {
    // Native code must not be loaded at module init (OpenAPI generation, tests).
    const { Decoder, Demuxer, WhisperTranscriber } = await import('node-av/api');
    const demuxer = await asBadRequest(() => Demuxer.open(audio));
    let decoder: NativeDecoder | undefined;
    let transcriber: NativeTranscriber | undefined;
    try {
      const stream = demuxer.audio();
      if (!stream) {
        throw new BadRequestException(STT_NO_AUDIO_MESSAGE);
      }
      decoder = await asBadRequest(() => Decoder.create(stream));
      transcriber = await WhisperTranscriber.create({
        language: language ?? 'auto',
        model: this.model,
        modelDir: this.modelDir,
        queue: 3,
        useGpu,
      });
      const segments: SttSegment[] = [];
      // The whisper filter is released when this generator returns, not by close().
      for await (const segment of transcriber.transcribe(
        decoder.frames(demuxer.packets(stream.index)),
      )) {
        segments.push({
          end: Math.round(segment.end),
          start: Math.round(segment.start),
          text: segment.text,
        });
      }
      return {
        device: useGpu ? 'gpu' : 'cpu',
        segments,
        text: segments.map((segment) => segment.text).join(' '),
      };
    } finally {
      await bestEffortCleanup(() => transcriber?.close());
      await bestEffortCleanup(() => decoder?.close());
      await bestEffortCleanup(() => demuxer.close());
    }
  }
}

/**
 * Translates a deterministic native input failure into a client error so the
 * device fallback loop does not turn it into a 503.
 * @param step - native call that rejects on invalid or unsupported audio
 * @returns the native handle produced by `step`
 * @throws BadRequestException with a constant message when the native call rejects
 */
async function asBadRequest<T>(step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch {
    throw new BadRequestException(STT_INVALID_AUDIO_MESSAGE);
  }
}

/**
 * Runs a native cleanup step without letting it skip later cleanup or replace
 * the original result or error.
 * @param step - native close call to attempt
 */
async function bestEffortCleanup(step: () => Promise<void> | void): Promise<void> {
  try {
    await step();
  } catch {
    logger.warn(STT_CLEANUP_MESSAGE);
  }
}
