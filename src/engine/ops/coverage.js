// Full coverage vector for one candidate: against E examples, which does it
// structurally unify with? Returns a Uint8 mask of length E. This is the unify_batch
// kernel specialized to a single candidate (one thread per example), used to confirm
// coverage once a candidate has passed the first-pass filter. CPU backend is the
// oracle; GPU backend dispatches coverage.metal.

import { packTerms, makeSymbols } from "../pack.js"
import { unifyPacked } from "./unify_packed.js"
import { resolveBackend } from "./backend.js"

export async function coverageVector(candidateTerm, exampleTerms, layout, options = {}) {
  const backend = await resolveBackend(options.backend)
  const E = exampleTerms.length
  const symbols = makeSymbols()

  if (backend === "gpu") return coverageGpu(candidateTerm, exampleTerms, layout, symbols, E)

  const { packed: packedC } = packTerms([candidateTerm], layout, { symbols })
  const { packed: packedE } = packTerms(exampleTerms, layout, { symbols })
  const mask = new Uint8Array(E)
  for (let e = 0; e < E; e++) {
    const a = { view: packedC.view, base: 0, slot: 0, side: "A" }
    const b = { view: packedE.view, base: e * layout.intsPerTerm, slot: 0, side: "B" }
    mask[e] = unifyPacked(a, b, layout) ? 1 : 0
  }
  return mask
}

async function coverageGpu(candidateTerm, exampleTerms, layout, symbols, E) {
  const device = await import("../gpu/device.js")
  const { poolPackedBuffer, releasePooled } = await import("../gpu/poolbuffer.js")
  const { run } = await import("../gpu/dispatch.js")

  const { packed: packedC } = packTerms([candidateTerm], layout, { symbols, alloc: poolPackedBuffer })
  const { packed: packedE } = packTerms(exampleTerms, layout, { symbols, alloc: poolPackedBuffer })

  const maskBuf = device.alloc(Math.max(E, 256), device.SHARED)
  const maskView = device.viewBuffer(maskBuf, E, Uint8Array)
  const params = new Uint32Array([layout.intsPerSlot, layout.maxArity, layout.slotsPerTerm, E])

  run(
    "coverage",
    [
      { buffer: packedC.buffer, index: 0 },
      { buffer: packedE.buffer, index: 1 },
      { buffer: maskBuf, index: 2 }
    ],
    { x: E },
    undefined,
    { data: params, index: 3 }
  )

  const mask = Uint8Array.from(maskView.subarray(0, E))
  releasePooled(packedC)
  releasePooled(packedE)
  device.releaseBuffer(maskBuf)
  return mask
}
