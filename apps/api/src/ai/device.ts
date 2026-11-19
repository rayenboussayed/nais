/**
 * Compute-device selection for the dedicated ONNX pipelines.
 *
 * The loader attempts the devices in {@link DEVICE_FALLBACK_CHAIN} order:
 * `webgpu` (Dawn WebGPU via the `webgpu` package, GPU when an adapter exists)
 * → `cpu` (onnxruntime-node). Any load failure on one device falls through to
 * the next; the last error is thrown when every device fails. Setting
 * `AI_DEVICE` pins a single device and disables the fallback (explicit
 * configuration wins, loudly).
 *
 * Note: transformers.js in Node supports `cuda`/`dml`/`coreml`/`webgpu`/`cpu`
 * only — `wasm` is the browser/onnxruntime-web provider and does not exist in
 * onnxruntime-node (verified live: `Unsupported device: "wasm"`), so it is
 * deliberately not offered here.
 */

/** Devices the pipeline loader may select, in default fallback order. */
export type AiDevice = 'cpu' | 'webgpu';

/** Default attempt order: WebGPU (Dawn), then the onnxruntime-node CPU backend. */
export const DEVICE_FALLBACK_CHAIN: readonly AiDevice[] = ['webgpu', 'cpu'];

/**
 * Type guard for {@link AiDevice}.
 * @param value - candidate device id
 * @returns true when `value` is a known device id
 */
export function isAiDevice(value: string): value is AiDevice {
  return value === 'webgpu' || value === 'cpu';
}

/**
 * Resolves the devices to attempt, in order.
 * @param pin - the `AI_DEVICE` value; unset/blank means the automatic fallback chain
 * @returns the ordered devices to attempt — a pinned device alone (no fallback), or the full chain
 * @throws Error on an unrecognized pin (env validation already rejects bad values at boot; bins may not)
 */
export function resolveDeviceChain(pin?: string): AiDevice[] {
  const trimmed = pin?.trim() ?? '';
  if (trimmed === '') return [...DEVICE_FALLBACK_CHAIN];
  if (isAiDevice(trimmed)) return [trimmed];
  throw new Error(`AI_DEVICE must be one of webgpu|cpu (unset means auto); got "${trimmed}"`);
}
