/**
 * Installs the Dawn WebGPU runtime (`webgpu` npm package: GPU* classes and a
 * `navigator.gpu` backed by Dawn) so `@huggingface/transformers` can run with
 * `device: 'webgpu'` in Node.
 *
 * Node ships a global `navigator` without a `gpu` property; transformers.js
 * probes `navigator.gpu` when device webgpu is requested. The Dawn instance
 * keeps native threads alive while referenced — the API server never exits,
 * so there is nothing to tear down; short-lived bins (e.g.
 * `bin/transformers-warmup.mjs`) must hard-exit instead of returning naturally.
 */

let installed = false;

/**
 * The Node global `navigator` (marked experimental in the lint rule's data;
 * present in this runtime since Node 21). Centralized so the deliberate
 * reference lives in one documented place.
 * @returns the global navigator object
 */
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- Node >= 21 ships globalThis.navigator (experimental per rule data); we feature-detect 'gpu' on it
const nodeNavigator = () => globalThis.navigator;

/**
 * Installs Dawn's globals exactly once per process. Safe to call before every
 * webgpu pipeline load; a no-op when a `gpu` object is already present.
 * @throws Error when the native binding cannot load (e.g. missing prebuilt for the platform) — callers are expected to fall back to the next device
 */
export async function ensureWebgpuGlobals(): Promise<void> {
  if (installed) return;
  if ('gpu' in nodeNavigator()) {
    installed = true;
    return;
  }
  const { create, globals } = await import('webgpu');
  Object.assign(globalThis, globals);
  const gpu = create([]);
  // Navigator instance is extensible on Node >= 21 (verified); defineProperty keeps this writable so tests can restore.
  Object.defineProperty(nodeNavigator(), 'gpu', {
    configurable: true,
    enumerable: false,
    value: gpu,
    writable: true,
  });
  installed = true;
}
