// Batched structural unification: for each (candidate, example) pair, does the
// candidate term structurally unify with the example term? Returns a Uint8 mask of
// B × E bits. The CPU backend (default) runs the reference unifyPacked per pair and is
// fully testable without a GPU; the GPU backend dispatches the unify_batch Metal
// kernel — one thread per pair — and is verified on Apple Silicon against the CPU
// backend. The two must agree on every shared test.

import { packTerms, makeSymbols } from "../pack.js"
import { unifyPacked } from "./unify_packed.js"
import { resolveBackend } from "./backend.js"

export async function unifyBatch(candidateTerms, exampleTerms, layout, options = {}) {
  const backend = await resolveBackend(options.backend)
  const B = candidateTerms.length
  const E = exampleTerms.length
  const symbols = makeSymbols() // shared, so functors/constants share ids across both sides

  if (backend === "gpu") return unifyBatchGpu(candidateTerms, exampleTerms, layout, symbols, B, E)

  const { packed: packedC } = packTerms(candidateTerms, layout, { symbols })
  const { packed: packedE } = packTerms(exampleTerms, layout, { symbols })
  const mask = new Uint8Array(B * E)
  for (let c = 0; c < B; c++) {
    for (let e = 0; e < E; e++) {
      const a = { view: packedC.view, base: c * layout.intsPerTerm, slot: 0, side: "A" }
      const b = { view: packedE.view, base: e * layout.intsPerTerm, slot: 0, side: "B" }
      mask[c * E + e] = unifyPacked(a, b, layout) ? 1 : 0
    }
  }
  return mask
}

async function unifyBatchGpu(candidateTerms, exampleTerms, layout, symbols, B, E) {
  const device = await import("../gpu/device.js")
  const { poolPackedBuffer, releasePooled } = await import("../gpu/poolbuffer.js")
  const { run } = await import("../gpu/dispatch.js")

  const { packed: packedC } = packTerms(candidateTerms, layout, { symbols, alloc: poolPackedBuffer })
  const { packed: packedE } = packTerms(exampleTerms, layout, { symbols, alloc: poolPackedBuffer })

  const maskBytes = B * E
  const maskBuf = device.alloc(Math.max(maskBytes, 256), device.SHARED)
  const maskView = device.viewBuffer(maskBuf, maskBytes, Uint8Array)
  const params = new Uint32Array([layout.intsPerSlot, layout.maxArity, layout.slotsPerTerm, E])

  run(
    "unify_batch",
    [
      { buffer: packedC.buffer, index: 0 },
      { buffer: packedE.buffer, index: 1 },
      { buffer: maskBuf, index: 2 }
    ],
    { x: B * E },
    undefined,
    { data: params, index: 3 }
  )

  const mask = Uint8Array.from(maskView.subarray(0, maskBytes))
  releasePooled(packedC)
  releasePooled(packedE)
  device.releaseBuffer(maskBuf)
  return mask
}
