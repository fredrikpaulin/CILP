// Allocates PackedBuffers from the lifted Metal buffer pool. Apple Silicon only: it
// imports the GPU device, which initializes Metal at import time, so this module is
// kept out of the CPU import graph and loaded only by the ops layer (#014) and the
// Mac-only tests. The CPU-backed equivalent is cpuPackedBuffer in ../buffer.js.

import * as device from "./device.js"
import { poolAlloc, poolFree } from "./pool.js"
import { makePackedBuffer } from "../buffer.js"

// Allocate a PackedBuffer from the pool, with a zero-copy typed view over the Metal
// shared buffer's memory — the same bytes the GPU sees.
export function poolPackedBuffer(byteLength, layout, ViewType = Int32Array) {
  const buffer = poolAlloc(byteLength, device.SHARED)
  const view = device.viewBuffer(buffer, byteLength, ViewType)
  return makePackedBuffer({ buffer, view, layout, byteLength, offset: 0 })
}

// Return a pooled PackedBuffer's backing buffer to the pool for reuse.
export function releasePooled(packed) {
  poolFree(packed.buffer, packed.byteLength, device.SHARED)
}
