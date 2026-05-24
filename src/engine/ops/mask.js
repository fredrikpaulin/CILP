// Constraint prune mask over a candidate frontier. Given a forbidden packed region
// (a clause or term the constraint learner has ruled out), mark every candidate whose
// packed region is identical to it — the GPU form of the clause-set-membership the CPU
// constraint store does for single-clause candidates: a one-clause program is pruned
// by too_general(C) / redundant exactly when its clause equals C. Because both sides
// are packed against one shared symbol table, structural equality is integer equality,
// which is all a thread does. (Subsumption-based masking — too_specific — is a
// refinement beyond exact equality and stays on the CPU for now.)

import { packTerms, makeSymbols } from "../pack.js"
import { resolveBackend } from "./backend.js"

export async function constraintMask(candidateRegions, forbiddenRegion, layout, options = {}) {
  const backend = await resolveBackend(options.backend)
  const B = candidateRegions.length
  const symbols = makeSymbols()

  if (backend === "gpu") return constraintMaskGpu(candidateRegions, forbiddenRegion, layout, symbols, B)

  const { packed: packedC } = packTerms(candidateRegions, layout, { symbols })
  const { packed: packedF } = packTerms([forbiddenRegion], layout, { symbols })
  const n = layout.intsPerTerm
  const mask = new Uint8Array(B)
  for (let c = 0; c < B; c++) {
    let equal = 1
    const base = c * n
    for (let i = 0; i < n; i++) {
      if (packedC.view[base + i] !== packedF.view[i]) { equal = 0; break }
    }
    mask[c] = equal
  }
  return mask
}

async function constraintMaskGpu(candidateRegions, forbiddenRegion, layout, symbols, B) {
  const device = await import("../gpu/device.js")
  const { poolPackedBuffer, releasePooled } = await import("../gpu/poolbuffer.js")
  const { run } = await import("../gpu/dispatch.js")

  const { packed: packedC } = packTerms(candidateRegions, layout, { symbols, alloc: poolPackedBuffer })
  const { packed: packedF } = packTerms([forbiddenRegion], layout, { symbols, alloc: poolPackedBuffer })

  const maskBuf = device.alloc(Math.max(B, 256), device.SHARED)
  const maskView = device.viewBuffer(maskBuf, B, Uint8Array)
  const params = new Uint32Array([layout.intsPerTerm])

  run(
    "constraint_mask",
    [
      { buffer: packedC.buffer, index: 0 },
      { buffer: packedF.buffer, index: 1 },
      { buffer: maskBuf, index: 2 }
    ],
    { x: B },
    undefined,
    { data: params, index: 3 }
  )

  const mask = Uint8Array.from(maskView.subarray(0, B))
  releasePooled(packedC)
  releasePooled(packedF)
  device.releaseBuffer(maskBuf)
  return mask
}
