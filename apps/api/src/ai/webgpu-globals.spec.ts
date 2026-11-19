import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const webgpuMock = vi.hoisted(() => ({
  create: vi.fn(),
  fakeGpu: { requestAdapter: async () => null },
  globals: { GPUBuffer: class FakeGPUBuffer {}, GPUDevice: class FakeGPUDevice {} },
}));

vi.mock('webgpu', () => ({
  create: webgpuMock.create,
  globals: webgpuMock.globals,
}));

/**
 * The Node global `navigator` (marked experimental in the lint rule's data;
 * present in this runtime since Node 21). Centralized so the deliberate
 * reference lives in one documented place.
 * @returns the global navigator object
 */
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- Node >= 21 ships globalThis.navigator (experimental per rule data); the tests feature-detect 'gpu' on it
const nodeNavigator = () => globalThis.navigator;

/**
 * Re-imports the module under test with a fresh module-level `installed` flag.
 * @returns the freshly loaded ensureWebgpuGlobals function
 */
const importEnsure = async () => (await import('./webgpu-globals.js')).ensureWebgpuGlobals;

const cleanGlobals = () => {
  Reflect.deleteProperty(nodeNavigator(), 'gpu');
  Reflect.deleteProperty(globalThis, 'GPUBuffer');
  Reflect.deleteProperty(globalThis, 'GPUDevice');
};

beforeEach(() => {
  vi.resetModules();
  cleanGlobals();
  webgpuMock.create.mockReset().mockReturnValue(webgpuMock.fakeGpu);
});

afterEach(() => {
  cleanGlobals();
});

describe('ensureWebgpuGlobals', () => {
  it('installs Dawn globals and navigator.gpu, exactly once per process', async () => {
    const ensure = await importEnsure();
    await ensure();

    expect(webgpuMock.create).toHaveBeenCalledTimes(1);
    expect(Reflect.get(nodeNavigator(), 'gpu')).toBe(webgpuMock.fakeGpu);
    expect(Reflect.get(globalThis, 'GPUDevice')).toBe(webgpuMock.globals.GPUDevice);
    expect(Reflect.get(globalThis, 'GPUBuffer')).toBe(webgpuMock.globals.GPUBuffer);

    await ensure();
    expect(webgpuMock.create).toHaveBeenCalledTimes(1);
  });

  it('does not touch Dawn when a gpu object is already present', async () => {
    const preexisting = { marker: 'someone-else' };
    Object.defineProperty(nodeNavigator(), 'gpu', {
      configurable: true,
      enumerable: false,
      value: preexisting,
      writable: true,
    });

    const ensure = await importEnsure();
    await ensure();

    expect(webgpuMock.create).not.toHaveBeenCalled();
    expect(Reflect.get(nodeNavigator(), 'gpu')).toBe(preexisting);
  });

  it('propagates Dawn load failures and re-attempts on the next call', async () => {
    webgpuMock.create.mockImplementation(() => {
      throw new Error('no native binding for this platform');
    });

    const ensure = await importEnsure();
    await expect(ensure()).rejects.toThrow('no native binding for this platform');
    expect(Reflect.get(nodeNavigator(), 'gpu')).toBeUndefined();

    // The failure must not latch: a later call re-attempts the install.
    webgpuMock.create.mockReset().mockReturnValue(webgpuMock.fakeGpu);
    await expect(ensure()).resolves.toBeUndefined();
    expect(Reflect.get(nodeNavigator(), 'gpu')).toBe(webgpuMock.fakeGpu);
  });
});
