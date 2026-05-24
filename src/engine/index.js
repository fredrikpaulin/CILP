// copper-ilp/engine — the synthesis engine. Runs on Bun (and, once the Metal layer
// lands, Apple Silicon). The hypothesis enumerator, constraint learner, and the
// synthesize entry point. Re-exports the core surface, so an engine consumer needs
// only one import.

export * from "../core/index.js"
export { enumerate, enumerateClauses } from "./enumerate.js"
export { makeConstraints, canonicalProgram, canonicalClause, subsumes } from "./constrain.js"
export { synthesize } from "./synthesize.js"
// Packing layer (CPU-safe; the Metal-backed allocator lives in gpu/poolbuffer.js and
// is not re-exported here, since importing it initializes Metal).
export {
  TAG, SLOT_FIELD, slotLayout, termLayout, clauseLayout, coverageMaskLayout,
  validateLayout, makePackedBuffer, cpuPackedBuffer
} from "./buffer.js"
export { makeSymbols, packTermInto, packTerms, batchByteLength } from "./pack.js"
export { unpackTermFrom, unpackTerms } from "./unpack.js"
// Batch ops: CPU references run anywhere; the GPU backend dispatches the Metal kernels
// and is loaded lazily, so importing these stays CPU-safe.
export { unifyPacked } from "./ops/unify_packed.js"
export { unifyBatch } from "./ops/unify_batch.js"
export { coverageVector } from "./ops/coverage.js"
export { constraintMask } from "./ops/mask.js"
export { gpuAvailable, resolveBackend } from "./ops/backend.js"
export { validateBias, buildBiasPrompt, parseBiasResponse, llmBiasProposer } from "./bias.js"
export { libraryRegistry } from "./registry.js"
