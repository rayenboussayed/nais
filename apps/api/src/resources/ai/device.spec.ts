import { describe, expect, it } from 'vitest';

import { DEVICE_FALLBACK_CHAIN, isAiDevice, resolveDeviceChain } from './device.js';

describe('isAiDevice', () => {
  it('accepts known device ids only', () => {
    expect(isAiDevice('webgpu')).toBe(true);
    expect(isAiDevice('cpu')).toBe(true);
    expect(isAiDevice('wasm')).toBe(false);
    expect(isAiDevice('cuda')).toBe(false);
    expect(isAiDevice('')).toBe(false);
  });
});

describe('resolveDeviceChain', () => {
  it('returns the automatic fallback chain when unset or blank', () => {
    expect(resolveDeviceChain()).toEqual(['webgpu', 'cpu']);
    expect(resolveDeviceChain(undefined)).toEqual(['webgpu', 'cpu']);
    expect(resolveDeviceChain('   ')).toEqual(['webgpu', 'cpu']);
    expect(resolveDeviceChain()).toEqual(DEVICE_FALLBACK_CHAIN);
  });

  it('pins a single device (whitespace tolerated) and disables the fallback', () => {
    expect(resolveDeviceChain('webgpu')).toEqual(['webgpu']);
    expect(resolveDeviceChain(' cpu ')).toEqual(['cpu']);
  });

  it('throws on an unrecognized pin instead of silently changing the chain', () => {
    expect(() => resolveDeviceChain('cuda')).toThrow(/AI_DEVICE/);
    expect(() => resolveDeviceChain('WEBGPU')).toThrow(/AI_DEVICE/);
  });
});
