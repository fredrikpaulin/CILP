// GPU bridge smoke test. Needs a working Metal GPU — run `bash build.sh` first to produce
// native/libcopper.dylib, then `bun test tests/gpu-smoke.test.js`. The gate is real GPU
// availability, not the platform: a Mac without the dylib built (or where Metal init fails)
// must skip this, not run it and crash. The bridge module is imported lazily inside the
// test body so the suite never tries to initialize Metal where it can't.

import { test, expect } from "bun:test"
import { gpuAvailable } from "../src/engine/ops/backend.js"

// gpuAvailable() probes by importing the device module inside a try and caches the result,
// so this top-level await resolves to false (never throws) wherever Metal is absent.
const gpuTest = (await gpuAvailable()) ? test : test.skip

gpuTest("the native bridge compiles and runs a trivial kernel end to end", async () => {
  const device = await import("../src/engine/gpu/device.js")

  // A kernel that writes each thread's index into the output buffer.
  const source = `#include <metal_stdlib>
using namespace metal;
kernel void fill_iota(device uint* out [[buffer(0)]], uint gid [[thread_position_in_grid]]) {
  out[gid] = gid;
}`

  const library = device.compileSource(source)
  const pipeline = device.createPipeline(library, "fill_iota")

  const N = 64
  const buffer = device.alloc(N * 4, device.SHARED)

  const enc = device.begin()
  device.setPipeline(enc, pipeline)
  device.setBuffer(enc, buffer, 0)
  device.dispatch(enc, N, 1, 1, Math.min(N, 256), 1, 1)
  device.endSync(enc)

  const view = device.viewBuffer(buffer, N * 4, Uint32Array)
  for (let i = 0; i < N; i++) expect(view[i]).toBe(i)

  device.releaseBuffer(buffer)
})
