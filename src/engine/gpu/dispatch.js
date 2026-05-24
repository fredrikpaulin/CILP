// copper/src/engine/gpu/dispatch.js
// Shader dispatch helper. Translates op-level calls into Metal command encoding.
// Everything in Copper's ops layer dispatches through here.
//
// Adapted from Smith (a Bun/Metal compute library, MIT, © Fredrik Paulin),
// src/dispatch.js, pinned to Smith commit d3327014. Changes: dropped the ML-specific
// parameter builders (matmul/broadcast/axis-reduce/scale) and the f16 kernel-name
// suffix — Copper's ops build their own params and have no half-precision path. The
// generic run/runElementwise dispatch core is unchanged.

import * as device from "./device.js"
import { isProfilingEnabled, recordKernel } from "./profile.js"

// Default threadgroup size for 1D kernels
const GROUP_1D = 256

// Dispatch a compute kernel synchronously.
// kernel: string name of the Metal kernel function
// buffers: array of { buffer: ptr, index: number }
// grid: { x, y?, z? } — total thread count
// group: { x, y?, z? } — threadgroup size (optional, defaults sensible)
// params: { data: TypedArray|Buffer, index: number } — inline constant data (optional)
function run(kernel, buffers, grid, group, params) {
  const pso = device.pipeline(kernel)
  const enc = device.begin()

  device.setPipeline(enc, pso)

  for (const b of buffers) {
    device.setBuffer(enc, b.buffer, b.index)
  }

  if (params) {
    const data = params.data
    const byteLength = data.byteLength || data.length
    device.setBytes(enc, data, byteLength, params.index)
  }

  const gx = grid.x || 1
  const gy = grid.y || 1
  const gz = grid.z || 1
  const grpX = group?.x || Math.min(gx, GROUP_1D)
  const grpY = group?.y || 1
  const grpZ = group?.z || 1

  device.dispatch(enc, gx, gy, gz, grpX, grpY, grpZ)

  if (isProfilingEnabled()) {
    const timing = device.endTimed(enc)
    recordKernel(kernel, timing.gpuMs)
  } else {
    device.endSync(enc)
  }
}

// Convenience: dispatch a kernel over a flat buffer of `size` elements.
function runElementwise(kernel, buffers, size) {
  run(kernel, buffers, { x: size }, { x: Math.min(size, GROUP_1D) })
}

export { run, runElementwise, GROUP_1D }
