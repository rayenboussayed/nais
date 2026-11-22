import { HttpStatus, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SttResponse } from '../../schemas/audio.js';

import { AudioController } from './audio.controller.js';
import { SttService } from './stt.service.js';

/** Parsed service response reused by the stub across the cases. */
const RESPONSE: SttResponse = {
  device: 'cpu',
  segments: [{ end: 1200, start: 0, text: 'hello world' }],
  text: 'hello world',
};

describe('AudioController', () => {
  let controller: AudioController;
  let stt: { transcribe: (audio: Buffer, language?: string) => Promise<SttResponse> };

  beforeEach(async () => {
    stt = { transcribe: vi.fn(async () => RESPONSE) };
    const moduleRef = await Test.createTestingModule({
      controllers: [AudioController],
      providers: [{ provide: SttService, useValue: stt }],
    }).compile();
    controller = moduleRef.get(AudioController);
  });

  it('decodes base64 audio and returns the service response', async () => {
    const audio = Buffer.from('fake audio bytes');
    const result = await controller.stt({ audio: audio.toString('base64') });
    expect(stt.transcribe).toHaveBeenCalledWith(audio, undefined);
    expect(result).toEqual(RESPONSE);
  });

  it('forwards the optional language selector to the service', async () => {
    const audio = Buffer.from('fake audio bytes');
    await controller.stt({ audio: audio.toString('base64'), language: 'fr' });
    expect(stt.transcribe).toHaveBeenCalledWith(audio, 'fr');
  });

  it('maps the handler to POST /api/audio/stt', () => {
    expect(Reflect.getMetadata('path', AudioController)).toBe('audio');
    const handler = AudioController.prototype.stt;
    expect(Reflect.getMetadata('path', handler)).toBe('stt');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata('__httpCode__', handler)).toBe(HttpStatus.OK);
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(3);
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
  });
});
