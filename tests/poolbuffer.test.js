// Pool-backed PackedBuffer test. Needs a working Metal GPU — run `bash build.sh` first.
// Verifies that a PackedBuffer allocated from the Metal pool gives a zero-copy view: writes
// through the view land in the GPU-visible shared buffer and read back. The gate is real GPU
// availability, not the platform: a Mac without the dylib built must skip, not crash. The
// module is imported lazily inside the test so the suite never starts Metal elsewhere.

import { test, expect } from "bun:test"
import { gpuAvailable } from "../src/engine/ops/backend.js"

// gpuAvailable() probes by importing the device module inside a try and caches the result,
// so this top-level await resolves to false (never throws) wherever Metal is absent.
const gpuTest = (await gpuAvailable()) ? test : test.skip

gpuTest("a pool-backed PackedBuffer is a zero-copy view over Metal shared memory", async () => {
  const { poolPackedBuffer, releasePooled } = await import("../src/engine/gpu/poolbuffer.js")
  const { termLayout } = await import("../src/engine/buffer.js")

  const layout = termLayout(4, 5)
  const pb = poolPackedBuffer(layout.intsPerTerm * 4, layout)

  expect(pb.buffer).not.toBe(null)        // a real MTLBuffer pointer
  expect(pb.view.length).toBe(layout.intsPerTerm)

  for (let i = 0; i < pb.view.length; i++) pb.view[i] = i * 3
  for (let i = 0; i < pb.view.length; i++) expect(pb.view[i]).toBe(i * 3)

  releasePooled(pb)
})
